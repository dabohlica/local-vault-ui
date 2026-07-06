import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { retrieve } from '@/lib/embeddings'
import { buildIngestPrompt } from '@/lib/prompts'
import { ollamaChatStructured } from '@/lib/ollama'
import { normalizeChanges } from '@/lib/healthFix'
import { applyTags } from '@/lib/tags'
import { reconcileUpdates } from '@/lib/merge'
import { annotateLossWarnings } from '@/lib/nightlyGuard'
import {
  IMAGE_EXTS, imageSlug, saveKnowledgeImage, describeImage, extractPdfImages,
  ensureImageSections, amendPrimaryChange, isSkipReply, OCR_PROMPT, PDF_IMAGE_PROMPT,
} from '@/lib/images'

export const dynamic = 'force-dynamic'

const TEXT_EXTS = new Set(['.md', '.markdown', '.txt', '.text'])
const MAX_CHARS = 12000 // keep within the model's context

type IngestResult = {
  changes: Array<{ path: string; action: 'create' | 'update'; content: string }>
  log_entry: string
  summary: string
  origin?: string
}

// Deterministic proposal used when the librarian model can't structure an
// OCR'd image/PDF into a note: the image is already saved and its OCR text in
// hand, so file that as-is rather than losing it. No further LLM involved.
function fallbackImageProposal(notePath: string, content: string, savedAt: string, tags: string[]): IngestResult {
  const changes = annotateLossWarnings(applyTags(normalizeChanges([
    { path: notePath, action: 'create' as const, content },
  ]), tags))
  return {
    changes: changes as IngestResult['changes'],
    log_entry: `Filed image knowledge at ${savedAt} with verbatim OCR (the local model could not draft a richer note).`,
    summary: `Image(s) filed with OCR under ${savedAt}`,
    origin: 'drop',
  }
}

async function extractText(ext: string, buffer: Buffer): Promise<string | null> {
  if (TEXT_EXTS.has(ext)) return buffer.toString('utf-8')
  if (ext === '.pdf') {
    try {
      // Dynamic import so a missing/broken pdf lib never breaks the rest of the app.
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: buffer })
      const result = await parser.getText()
      return result.text
    } catch {
      return null
    }
  }
  return null
}

// Turn a source (document text, or an image's vision description) into a proposed
// note. Robust to large/awkward sources: retries with progressively smaller slices
// so a big PDF yields a note instead of a 502, and returns a friendly 422 if the
// local model still can't structure it (rather than a raw "invalid JSON"). The
// retrieval context is computed once; only the source slice shrinks between tries.
const INGEST_NUM_CTX = 16384
const CLIP_STEPS = [MAX_CHARS, 5000, 2500]

async function ingestSource(
  filename: string,
  fullSourceText: string,
  assetPath: string | undefined,
  userNotes: string | undefined,
  tags: string[],
): Promise<NextResponse | IngestResult> {
  const retrievalQuery = `${userNotes ? userNotes + ' ' : ''}${fullSourceText}`.slice(0, 2000)
  const chunks = await retrieve(retrievalQuery, 6)

  for (const limit of CLIP_STEPS) {
    // Skip redundant smaller passes when the source is already short.
    if (limit !== MAX_CHARS && limit >= fullSourceText.length) continue
    const clipped = fullSourceText.slice(0, limit)
    const messages = buildIngestPrompt(filename, clipped, chunks, assetPath, userNotes, tags)

    let result: IngestResult | null
    try {
      // attempts:1 — this loop already retries by shrinking the source, so don't
      // double-retry at the same size; just take one shot per slice.
      ;({ result } = await ollamaChatStructured<IngestResult>({ messages, numCtx: INGEST_NUM_CTX, role: 'librarian', attempts: 1 }))
    } catch (err) {
      // Model/host error (not a parsing issue) — retrying smaller won't help.
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Ingest failed' }, { status: 502 })
    }

    if (result && Array.isArray(result.changes) && result.changes.length > 0) {
      // Guarantee the user's chosen tags land on the note (code-enforced).
      result.changes = annotateLossWarnings(applyTags(normalizeChanges(await reconcileUpdates(result.changes)), tags))
      return { ...result, origin: 'drop' }
    }
    // else: shrink the source and try again
  }

  return NextResponse.json(
    {
      error:
        'The local model couldn’t structure this document into a note. It may be very large or mostly ' +
        'non-text (e.g. a scanned PDF with little extractable text). Try a smaller or text-based source, ' +
        'or drop it and add a short note describing what it is.',
    },
    { status: 422 },
  )
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const filename = file.name
    const ext = path.extname(filename).toLowerCase()
    const buffer = Buffer.from(await file.arrayBuffer())

    // Optional user-supplied notes to steer the summary (high priority).
    const notesField = form.get('notes')
    const userNotes = typeof notesField === 'string' ? notesField : undefined

    // Optional tags to stamp onto the resulting note (sent as a JSON array string).
    const tagsField = form.get('tags')
    let tags: string[] = []
    if (typeof tagsField === 'string' && tagsField.trim()) {
      try { const parsed = JSON.parse(tagsField); if (Array.isArray(parsed)) tags = parsed.map(String) } catch { /* ignore malformed */ }
    }

    // --- Image branch: store under Knowledge/Images/, OCR it, note carries the text ---
    if (IMAGE_EXTS.has(ext)) {
      // Dropped images are filed by month; PDF extractions get per-source folders.
      const assetPath = saveKnowledgeImage(new Date().toISOString().slice(0, 7), filename, buffer)
      const description = await describeImage(buffer.toString('base64'), OCR_PROMPT)
      if (description === null) {
        // No installed model could read the image — keep the saved file, skip the note.
        return NextResponse.json({
          savedOnly: true,
          savedPath: assetPath,
          summary: `Saved ${assetPath} (no multimodal model available — set a vision-capable model, or use a multimodal chat model, in Settings).`,
        })
      }

      const sourceText = `Image file saved at ${assetPath}.\n\nVisual description and transcribed text:\n${description}`
      const out = await ingestSource(filename, sourceText, assetPath, userNotes, tags)
      if (out instanceof NextResponse) {
        // The librarian model couldn't draft a richer note — but the OCR already
        // succeeded, so keep the knowledge with a deterministic note instead of
        // failing the drop. normalizeChanges adds frontmatter + preamble.
        return NextResponse.json(fallbackImageProposal(
          `Knowledge/${imageSlug(filename)}.md`,
          ensureImageSections(userNotes ? `## Notes\n${userNotes}` : '', assetPath, description),
          assetPath, tags,
        ))
      }
      // Embed + verbatim OCR are guaranteed in code, not left to the model.
      out.changes = amendPrimaryChange(out.changes, c => ensureImageSections(c, assetPath, description))
      return NextResponse.json(out)
    }

    // --- Text branch ---
    const text = await extractText(ext, buffer)
    if (text === null) {
      return NextResponse.json({ error: 'unsupported', detail: `Can't extract text from ${filename}` }, { status: 415 })
    }
    if (ext !== '.pdf') {
      if (!text.trim()) {
        return NextResponse.json({ error: 'Document appears to be empty' }, { status: 400 })
      }
      const out = await ingestSource(filename, text, undefined, userNotes, tags)
      return out instanceof NextResponse ? out : NextResponse.json(out)
    }

    // --- PDF branch: text plus embedded figures ---
    // The vision model judges each extracted image: knowledge-carrying figures
    // (charts, tables, screenshots, diagrams) are stored under Knowledge/Images/
    // and appended to the note with verbatim OCR; decorative ones come back SKIP
    // and are never written. For a scanned/image-only PDF (no text layer), the
    // images' OCR *becomes* the source text instead of failing with "empty".
    const kept: Array<{ savedPath: string; page: number; name: string; reply: string }> = []
    try {
      const images = await extractPdfImages(buffer, { max: 5 })
      const folder = imageSlug(filename)
      for (const img of images) {
        const reply = await describeImage(img.buffer.toString('base64'), PDF_IMAGE_PROMPT)
        if (!reply || isSkipReply(reply)) continue
        const savedPath = saveKnowledgeImage(folder, `page${img.page}-${img.name}.png`, img.buffer)
        kept.push({ savedPath, page: img.page, name: img.name, reply: reply.trim().slice(0, 2500) })
      }
    } catch { /* image pass is optional — text (if any) stands on its own */ }

    const sourceText = text.trim()
      ? text
      : kept.map(k => `Image on page ${k.page}:\n${k.reply}`).join('\n\n')
    if (!sourceText.trim()) {
      return NextResponse.json({ error: 'Document appears to be empty (no text layer and no readable images)' }, { status: 400 })
    }

    const imageSection = kept.length > 0
      ? `\n\n## Extracted images\n> Figures extracted from the PDF, judged to carry knowledge. Text is verbatim OCR.\n\n` +
        kept.map(k => `### Page ${k.page} — ${k.name}\n![[${k.savedPath}]]\n\n${k.reply}`).join('\n\n')
      : ''

    const out = await ingestSource(filename, sourceText, undefined, userNotes, tags)
    if (out instanceof NextResponse) {
      if (kept.length === 0) return out
      // Drafting failed but the figures are OCR'd and saved — keep the knowledge
      // with a deterministic note rather than failing the whole drop.
      return NextResponse.json(fallbackImageProposal(
        `Knowledge/${imageSlug(filename)}.md`,
        `${userNotes ? `## Notes\n${userNotes}\n` : ''}${imageSection.trimStart()}`,
        `Knowledge/Images/${imageSlug(filename)}/`, tags,
      ))
    }
    if (kept.length > 0) {
      out.changes = amendPrimaryChange(out.changes, c => `${c}${imageSection}`)
      out.summary = `${out.summary} (+${kept.length} image(s) extracted to Knowledge/Images/${imageSlug(filename)}/)`
    }
    return NextResponse.json(out)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ingest failed' },
      { status: 500 }
    )
  }
}
