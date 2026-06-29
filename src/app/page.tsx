import { BriefingCard } from '@/components/dashboard/BriefingCard'
import { VaultStatsCard } from '@/components/dashboard/VaultStatsCard'
import { QuickCaptureCard } from '@/components/dashboard/QuickCaptureCard'
import { ActivityTimelineCard } from '@/components/dashboard/ActivityTimelineCard'

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold gradient-text">Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Your knowledge vault at a glance
        </p>
      </div>

      {/* Two columns: AI Briefing on the left; a self-contained right stack so the
          Activity Timeline packs directly beneath Stats + Quick Capture regardless
          of the Briefing's height. */}
      <div className="bento-grid">
        <BriefingCard />

        <div className="col-span-2 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <VaultStatsCard />
            <QuickCaptureCard />
          </div>
          <ActivityTimelineCard />
        </div>
      </div>
    </div>
  )
}
