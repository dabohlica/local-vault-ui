import { NextResponse } from 'next/server'
import { ollamaWarm } from '@/lib/ollama'

export const dynamic = 'force-dynamic'
// A cold model load can take minutes — give it room rather than letting the
// platform abort the warmup early.
export const maxDuration = 300

// Preload the local models so the user's first real request is fast (avoids the
// cold-load "NetworkError"). Fire-and-forget from the client on app open and on an
// interval; always 200 so a missing Ollama never surfaces as an error in the UI.
export async function POST() {
  try {
    await ollamaWarm()
  } catch { /* non-fatal */ }
  return NextResponse.json({ ok: true })
}
