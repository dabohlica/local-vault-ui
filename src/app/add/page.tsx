'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ProposalFlow } from '@/components/shared/ProposalFlow'
import { PageHeader } from '@/components/shared/PageHeader'

// The single "add knowledge" entry. Paste anything — a meeting, a fact about a
// person, a project update, a stray thought — and the local model decides which
// note(s) to create or update (it may touch several files), then shows the changes
// as diffs to approve. Files go through the same pipeline via global drag-and-drop.
function AddForm() {
  const params = useSearchParams()
  return (
    <ProposalFlow
      inputLabel=""
      inputPlaceholder={'e.g. Kickoff with Example Company — we agreed on the audit scope. Max Mustermann (their CTO) owns the tooling. Next milestone in two weeks.'}
      submitLabel="File it"
      storageKey="add-input-height"
      enableTags
      initialText={params.get('text') ?? ''}
      request={(input, tags) =>
        fetch('/api/curate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: input, tags }),
        })
      }
    />
  )
}

export default function AddPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Add a note"
        subtitle="Write it the way you’d tell a colleague. It gets filed into the right notes (people, projects, today’s log), and you see every change before it’s saved. To add a file, drop it anywhere."
      />
      <Suspense fallback={null}>
        <AddForm />
      </Suspense>
    </div>
  )
}
