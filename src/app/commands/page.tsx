import { Suspense } from 'react'
import { CommandGrid } from '@/components/commands/CommandGrid'
import { PageHeader } from '@/components/shared/PageHeader'

export default function ToolsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Tools" subtitle="Bigger jobs I can do for your notes. Everything stays on this Mac, and I show you every change before saving." />
      <Suspense fallback={null}>
        <CommandGrid />
      </Suspense>
    </div>
  )
}
