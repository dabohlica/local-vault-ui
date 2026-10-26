import { Suspense } from 'react'
import { CommandGrid } from '@/components/commands/CommandGrid'
import { PageHeader } from '@/components/shared/PageHeader'

export default function ToolsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Tools" subtitle="Everything runs on this Mac. You see every change before it’s saved." />
      <Suspense fallback={null}>
        <CommandGrid />
      </Suspense>
    </div>
  )
}
