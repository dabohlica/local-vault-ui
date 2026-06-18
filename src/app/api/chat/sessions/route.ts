import { NextResponse } from 'next/server'
import { listSessions, clearAllSessions } from '@/lib/chatHistory'

// List recent sessions for the sidebar.
export async function GET() {
  return NextResponse.json({ sessions: listSessions() })
}

// Clear ALL sessions.
export async function DELETE() {
  clearAllSessions()
  return NextResponse.json({ success: true })
}
