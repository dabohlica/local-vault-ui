import { BriefingCard } from '@/components/dashboard/BriefingCard'
import { VaultStatsCard } from '@/components/dashboard/VaultStatsCard'
import { RecentFilesCard } from '@/components/dashboard/RecentFilesCard'
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

      {/* Bento grid */}
      <div className="bento-grid">
        {/* AI Briefing — 2 cols wide, 2 rows tall */}
        <BriefingCard />

        {/* Vault Stats — 1×1 */}
        <VaultStatsCard />

        {/* Quick Capture — 1×1 */}
        <QuickCaptureCard />

        {/* Recent Files — right column, spans cols 3–4 (under Stats + Quick Capture) */}
        <RecentFilesCard />

        {/* Activity Timeline — directly beneath Recent Files, same width (traceability) */}
        <ActivityTimelineCard />
      </div>
    </div>
  )
}
