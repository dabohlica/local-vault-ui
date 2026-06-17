'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  FolderOpen, Cpu, Database, CheckCircle2, XCircle, Loader2, Download,
  ArrowRight, BookOpen, RefreshCw,
} from 'lucide-react'

type Status = {
  configured: boolean
  vault: { path: string; valid: boolean; noteCount: number }
  ollama: {
    host: string; reachable: boolean; installed: string[]
    chatModel: string; embedModel: string; visionModel: string
    hasChatModel: boolean; hasEmbedModel: boolean; hasVisionModel: boolean
  }
  index: { chunks: number; built: boolean }
}

export default function SetupPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  const [vaultInput, setVaultInput] = useState('')
  const [savingVault, setSavingVault] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [pulling, setPulling] = useState<string | null>(null)
  const [pullMsg, setPullMsg] = useState('')
  const [building, setBuilding] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/setup/status')
    const data = await res.json() as Status
    setStatus(data)
    if (!vaultInput && data.vault.path) setVaultInput(data.vault.path)
    return data
  }, [vaultInput])

  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveVault() {
    if (!vaultInput.trim()) return
    setSavingVault(true)
    setVaultError(null)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultPath: vaultInput.trim() }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not set vault')
      await refresh()
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Could not set vault')
    } finally {
      setSavingVault(false)
    }
  }

  function pullModel(model: string) {
    setPulling(model)
    setPullMsg('starting…')
    const es = new EventSource(`/api/setup/pull?model=${encodeURIComponent(model)}`)
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as { type: string; status?: string; pct?: number; message?: string }
      if (ev.type === 'progress') setPullMsg(`${ev.status ?? 'downloading'}${ev.pct != null ? ` ${ev.pct}%` : ''}`)
      else if (ev.type === 'error') { setPullMsg(`error: ${ev.message}`); es.close(); setPulling(null) }
      else if (ev.type === 'done') { es.close(); setPulling(null); setPullMsg(''); void refresh() }
    }
    es.onerror = () => { es.close(); setPulling(null); setPullMsg('connection lost') }
  }

  async function buildIndex() {
    setBuilding(true)
    try {
      await fetch('/api/index/rebuild', { method: 'POST' })
      await refresh()
    } finally {
      setBuilding(false)
    }
  }

  const s = status
  const vaultReady = !!s?.vault.valid
  const modelsReady = !!s?.ollama.hasChatModel && !!s?.ollama.hasEmbedModel
  const indexReady = !!s?.index.built
  const allReady = vaultReady && modelsReady && indexReady

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 py-2">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3" style={{ background: 'var(--icon-grad)' }}>
          <BookOpen size={26} style={{ color: 'var(--primary)' }} />
        </div>
        <h1 className="text-2xl font-bold gradient-text">Welcome to Vault UI</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
          A local-first second brain. Three quick steps and everything runs on your machine — no cloud, no data leaving your device.
        </p>
      </div>

      {/* Step 1 — Vault */}
      <StepCard n={1} title="Connect your vault" icon={FolderOpen} done={vaultReady}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          Paste the absolute path to your Obsidian vault folder (e.g. <span className="font-mono">~/Documents/Second-Brain</span>).
        </p>
        <div className="flex gap-2">
          <input
            value={vaultInput}
            onChange={e => setVaultInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void saveVault() }}
            placeholder="/Users/you/path/to/vault"
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none font-mono"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
          <button
            onClick={() => void saveVault()}
            disabled={savingVault || !vaultInput.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
          >
            {savingVault ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Connect
          </button>
        </div>
        {vaultError && <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>{vaultError}</p>}
        {vaultReady && (
          <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
            <CheckCircle2 size={12} /> Connected — {s?.vault.noteCount} notes found
          </p>
        )}
      </StepCard>

      {/* Step 2 — Ollama + models */}
      <StepCard n={2} title="Local AI models" icon={Cpu} done={modelsReady}>
        {!s?.ollama.reachable ? (
          <div className="text-xs flex items-start gap-2" style={{ color: 'var(--danger)' }}>
            <XCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Ollama isn&apos;t running at {s?.ollama.host}.</p>
              <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                Install it from <span className="font-mono">ollama.com</span>, then run <span className="font-mono">ollama serve</span> and refresh.
              </p>
              <button onClick={() => void refresh()} className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <RefreshCw size={11} /> Re-check
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ModelRow label="Chat model" model={s.ollama.chatModel} ok={s.ollama.hasChatModel}
              pulling={pulling === s.ollama.chatModel} pullMsg={pullMsg} onPull={() => pullModel(s.ollama.chatModel)} disabled={!!pulling} />
            <ModelRow label="Embedding model" model={s.ollama.embedModel} ok={s.ollama.hasEmbedModel}
              pulling={pulling === s.ollama.embedModel} pullMsg={pullMsg} onPull={() => pullModel(s.ollama.embedModel)} disabled={!!pulling} />
            <ModelRow label="Vision model (optional — for image ingestion)" model={s.ollama.visionModel} ok={s.ollama.hasVisionModel} optional
              pulling={pulling === s.ollama.visionModel} pullMsg={pullMsg} onPull={() => pullModel(s.ollama.visionModel)} disabled={!!pulling} />
          </div>
        )}
      </StepCard>

      {/* Step 3 — Index */}
      <StepCard n={3} title="Build the search index" icon={Database} done={indexReady}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          Embeds your notes locally so Chat can retrieve and cite them. Runs once; updates incrementally after.
        </p>
        <button
          onClick={() => void buildIndex()}
          disabled={building || !vaultReady || !modelsReady}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
        >
          {building ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
          {building ? 'Embedding notes…' : indexReady ? 'Rebuild index' : 'Build index'}
        </button>
        {!vaultReady || !modelsReady ? (
          <p className="text-xs mt-2" style={{ color: 'var(--text-subtle)' }}>Finish steps 1 and 2 first.</p>
        ) : indexReady ? (
          <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
            <CheckCircle2 size={12} /> {s?.index.chunks} chunks indexed
          </p>
        ) : null}
      </StepCard>

      <button
        onClick={() => router.push('/')}
        disabled={!allReady}
        className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: allReady ? 'linear-gradient(135deg, var(--primary), var(--accent))' : 'var(--bg-elevated)', color: allReady ? 'white' : 'var(--text-subtle)', border: allReady ? 'none' : '1px solid var(--border)' }}
      >
        {allReady ? 'Enter your vault' : 'Complete the steps above to continue'}
        {allReady && <ArrowRight size={16} />}
      </button>
    </div>
  )
}

function StepCard({ n, title, icon: Icon, done, children }: {
  n: number; title: string; icon: React.ElementType; done: boolean; children: React.ReactNode
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: done ? 'rgba(29,155,108,0.15)' : 'var(--icon-grad)' }}>
          {done ? <CheckCircle2 size={16} style={{ color: 'var(--success)' }} /> : <Icon size={16} style={{ color: 'var(--primary)' }} />}
        </div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          <span style={{ color: 'var(--text-subtle)' }}>Step {n} · </span>{title}
        </h2>
      </div>
      <div className="pl-11">{children}</div>
    </div>
  )
}

function ModelRow({ label, model, ok, pulling, pullMsg, onPull, disabled, optional }: {
  label: string; model: string; ok: boolean; pulling: boolean; pullMsg: string; onPull: () => void; disabled: boolean; optional?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      {ok ? <CheckCircle2 size={15} style={{ color: 'var(--success)' }} /> : <XCircle size={15} style={{ color: optional ? 'var(--text-subtle)' : 'var(--text-subtle)' }} />}
      <div className="flex-1 min-w-0">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
        <p className="text-sm font-mono truncate" style={{ color: 'var(--text)' }}>{model}</p>
      </div>
      {ok ? (
        <span className="text-xs" style={{ color: 'var(--success)' }}>installed</span>
      ) : pulling ? (
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--primary)' }}>
          <Loader2 size={12} className="animate-spin" /> {pullMsg}
        </span>
      ) : (
        <button onClick={onPull} disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'var(--primary-tint)', color: 'var(--primary)', border: '1px solid var(--border)' }}>
          <Download size={11} /> Pull
        </button>
      )}
    </div>
  )
}
