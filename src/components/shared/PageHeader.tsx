// Consistent page title + one-line explanation. Actions sit on the right.
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>{title}</h1>
        {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--text-subtle)' }}>{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-shrink-0">{children}</div>}
    </div>
  )
}
