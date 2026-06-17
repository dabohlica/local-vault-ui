import { CommandGrid } from '@/components/commands/CommandGrid'

export default function CommandsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold gradient-text">Commands</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Vault workflows that run entirely on-device via Ollama. Every command proposes changes for your
          review before anything is written — nothing leaves your machine.
        </p>
      </div>
      <CommandGrid />
    </div>
  )
}
