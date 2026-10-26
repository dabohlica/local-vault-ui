import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Overnight suggestions now live in the Inbox.
export default function ReviewPage() {
  redirect('/inbox?tab=suggestions')
}
