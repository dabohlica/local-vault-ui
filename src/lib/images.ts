import fs from 'fs'
import path from 'path'
import { getVaultPath } from '@/lib/vault'
import { getConfig } from '@/lib/config'
import { ollamaVisionChat } from '@/lib/ollama'

// Image knowledge pipeline. Images live INSIDE the knowledge tree — not in a flat
// Assets/ dump — so they sit next to the notes that reference them and the vault
// stays navigable:
//   Knowledge/Images/<YYYY-MM>/<file>          — individually dropped images
//   Knowledge/Images/<source-slug>/<page-img>  — images extracted from a PDF
// The OCR/vision text is stored verbatim in the referencing note (## OCR section),
// which is what makes an image RETRIEVABLE: the note gets embedded like any other,
// so a query matching the image's text surfaces the note, and the note carries the
// ![[embed]] the UI renders.

export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export function isImagePath(p: string): boolean {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase())
}

export const IMAGES_ROOT = 'Knowledge/Images'

// Folder-safe slug from a filename or title ("Q3 Report (v2).pdf" → "Q3-Report-v2").
export function imageSlug(title: string): string {
  const base = title.replace(/\.[a-z0-9]+$/i, '')
  const slug = base.replace(/[^A-Za-z0-9À-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug || 'untitled'
}

// Write an image into Knowledge/Images/<folder>/, deduping on collision by
// timestamp prefix. Returns the vault-relative path (what a ![[…]] embed uses).
export function saveKnowledgeImage(folder: string, filename: string, buffer: Buffer): string {
  const dir = path.join(getVaultPath(), IMAGES_ROOT, folder)
  fs.mkdirSync(dir, { recursive: true })
  let target = path.join(dir, filename)
  if (fs.existsSync(target)) target = path.join(dir, `${Date.now()}-${filename}`)
  fs.writeFileSync(target, buffer)
  return path.relative(getVaultPath(), target)
}

// Describe/OCR an image with the vision model, falling back to the chat model so
// a multimodal chat model (e.g. Gemma 3) works without a separate vision install.
// Returns null when no installed model can read images.
export async function describeImage(base64: string, prompt: string): Promise<string | null> {
  const cfg = getConfig()
  const candidates = Array.from(new Set([cfg.visionModel, cfg.chatModel].filter(Boolean)))
  for (const model of candidates) {
    try {
      return await ollamaVisionChat({ prompt, imagesBase64: [base64], model })
    } catch { /* model missing or not multimodal — try the next candidate */ }
  }
  return null
}

export const OCR_PROMPT =
  'Describe this image in detail and transcribe ALL visible text exactly. Be concise but complete.'

// For PDF-extracted images the model also acts as the "adds know-how?" judge:
// decorative material comes back as SKIP and is never written to the vault.
export const PDF_IMAGE_PROMPT =
  'This image was extracted from a PDF document. If it conveys meaningful information — text, a ' +
  'diagram, chart, table, screenshot, map, or anything carrying knowledge — describe it and ' +
  'transcribe ALL visible text exactly. If it is merely decorative (a logo, divider, stock photo, ' +
  'icon, or background), reply with exactly: SKIP'

export function isSkipReply(reply: string): boolean {
  return reply.trim().slice(0, 20).toUpperCase().includes('SKIP')
}

// Verbatim OCR block appended to the image's note. Stored in the note (not a
// sidecar) so the embedding index picks it up and queries can match the image.
export function ocrSection(ocr: string): string {
  return `\n\n## OCR\n> Vision-model extraction, verbatim — the image's searchable text.\n\n${ocr.trim().slice(0, 4000)}`
}

// Make sure a note carries the image embed and the verbatim OCR text —
// code-enforced, not left to the model.
export function ensureImageSections(content: string, assetPath: string, ocr: string): string {
  let out = content
  if (!out.includes(`![[${assetPath}`)) out += `\n\n## Image\n![[${assetPath}]]`
  if (!/^## OCR\b/m.test(out)) out += ocrSection(ocr)
  return out
}

// Apply fn to the first create/update change (the primary note of a proposal).
export function amendPrimaryChange<T extends { action?: string; content?: string }>(
  changes: T[],
  fn: (content: string) => string
): T[] {
  const i = changes.findIndex(c => (c.action === 'create' || c.action === 'update') && typeof c.content === 'string')
  if (i === -1) return changes
  const next = [...changes]
  next[i] = { ...next[i], content: fn(next[i].content!) }
  return next
}

export type PdfImage = { name: string; page: number; buffer: Buffer; width: number; height: number }

// Extract embedded raster images from a PDF, largest first, capped. Tiny images
// (icons, tracking pixels, decorations) are dropped via pdf-parse's threshold.
export async function extractPdfImages(buffer: Buffer, opts: { max?: number; minDim?: number } = {}): Promise<PdfImage[]> {
  const max = opts.max ?? 5
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getImage({ imageThreshold: opts.minDim ?? 150, imageDataUrl: true, imageBuffer: false })
    const out: PdfImage[] = []
    for (const page of result.pages ?? []) {
      for (const img of page.images ?? []) {
        // dataUrl is a properly-encoded PNG; the raw `data` field is pixel data.
        const b64 = img.dataUrl?.split(',')[1]
        if (!b64) continue
        out.push({
          name: img.name || `img${out.length + 1}`,
          page: page.pageNumber,
          buffer: Buffer.from(b64, 'base64'),
          width: img.width,
          height: img.height,
        })
      }
    }
    out.sort((a, b) => b.width * b.height - a.width * a.height)
    return out.slice(0, max)
  } catch {
    return [] // no images / malformed PDF — the text ingest already succeeded
  }
}
