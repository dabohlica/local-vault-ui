import { NextRequest, NextResponse } from 'next/server'
import { getSession, deleteSession } from '@/lib/chatHistory'

// Full session (messages) to reopen a conversation.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = getSession(id)
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(s)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  deleteSession(id)
  return NextResponse.json({ success: true })
}
