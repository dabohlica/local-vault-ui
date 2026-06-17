import { diffLines } from 'diff'

type Props = {
  before: string | null
  after: string
}

export function DiffView({ before, after }: Props) {
  const parts = diffLines(before ?? '', after)

  return (
    <pre
      className="text-xs rounded-xl p-3 overflow-x-auto max-h-80 overflow-y-auto"
      style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', fontFamily: 'ui-monospace, monospace' }}
    >
      {parts.map((part, i) => (
        <div
          key={i}
          style={{
            background: part.added ? 'rgba(16,185,129,0.12)' : part.removed ? 'rgba(239,68,68,0.12)' : 'transparent',
            color: part.added ? 'var(--success)' : part.removed ? 'var(--danger)' : 'var(--text-muted)',
          }}
        >
          {(() => {
            const lines = part.value.split('\n')
            if (lines[lines.length - 1] === '') lines.pop()
            return lines.map((line, j) => (
              <div key={j}>
                {part.added ? '+ ' : part.removed ? '- ' : '  '}{line}
              </div>
            ))
          })()}
        </div>
      ))}
    </pre>
  )
}
