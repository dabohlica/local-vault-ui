import { CommandGrid } from '@/components/commands/CommandGrid'

export default function CommandsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold gradient-text">Commands</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          On-demand tools that run entirely on-device via Ollama: synthesize a topic or recap, and keep the
          vault tidy (these maintenance scans also run automatically). Every change is reviewed before it&rsquo;s
          written — nothing leaves your machine.
        </p>
      </div>
      <CommandGrid />
    </div>
  )
}
