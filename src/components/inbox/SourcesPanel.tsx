'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Loader2, AlertCircle, Rss, GraduationCap } from 'lucide-react'
import { useToast } from '@/components/shared/Toast'
import type { Source } from '@/lib/sources'
import type { SourceState } from '@/lib/inbox'

type Settings = { feedsEnabled: boolean; feedIntervalHours: number; briefingHour: number; feedNoteFolder: string }
type Draft = Partial<Source> & { kind: Source['kind'] }

const EMPTY_DRAFT: Draft = { kind: 'arxiv', name: '', section: 'research', query: '', url: '', maxItems: 30, enabled: true }

const inputStyle = { background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text)' }
const inputCls = 'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--primary-tint-strong)]'

function ago(ms: number | null): string {
  if (!ms) return 'never fetched'
  const m = Math.floor((Date.now() - ms) / 60_000)
  if (m < 60) return `${m} min ago`
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ago`
  return `${Math.floor(m / 1440)} d ago`
}

export function SourcesPanel({ onChanged }: { onChanged?: () => void }) {
  const { showToast } = useToast()
  const [sources, setSources] = useState<Source[] | null>(null)
  const [presets, setPresets] = useState<Array<Omit<Source, 'id' | 'enabled' | 'maxItems'>>>([])
  const [states, setStates] = useState<Record<string, SourceState>>({})
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const d = await fetch('/api/sources', { cache: 'no-store' }).then(r => r.json())
    setSources(d.sources); setPresets(d.presets); setStates(d.states); setSettings(d.settings)
  }, [])
  useEffect(() => { void load() }, [load])

  async function save(next: Source[] | Draft[]): Promise<boolean> {
    setSaving(true)
    try {
      const r = await fetch('/api/sources', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: next }) })
      const d = await r.json()
      if (!r.ok) { showToast(d.error ?? 'Could not save sources', 'error'); return false }
      setSources(d.sources)
      onChanged?.()
      return true
    } finally { setSaving(false) }
  }

  async function saveSettings(patch: Partial<Settings>) {
    const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    const d = await r.json()
    if (!r.ok) { showToast(d.error ?? 'Could not save', 'error'); return }
    setSettings({ feedsEnabled: d.config.feedsEnabled, feedIntervalHours: d.config.feedIntervalHours, briefingHour: d.config.briefingHour, feedNoteFolder: d.config.feedNoteFolder })
  }

  async function submitDraft() {
    if (!draft || !sources) return
    const exists = draft.id && sources.some(s => s.id === draft.id)
    const next = exists ? sources.map(s => (s.id === draft.id ? { ...s, ...draft } : s)) : [...sources, draft]
    if (await save(next as Source[])) setDraft(null)
  }

  if (!sources || !settings) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
  }

  const sections = Array.from(new Set(sources.map(s => s.section).concat(['research', 'work', 'tech', 'personal'])))
  const unusedPresets = presets.filter(p => !sources.some(s => s.name === p.name))

  return (
    <div className="flex flex-col gap-5">
      {/* Schedule */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Schedule</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>Runs on the server — no open tab needed.</p>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={settings.feedsEnabled} onChange={e => void saveSettings({ feedsEnabled: e.target.checked })} />
            Automatic
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <label className="flex flex-col gap-1" style={{ color: 'var(--text-muted)' }}>
            <span className="text-xs">Check sources every</span>
            <select className={inputCls} style={inputStyle} value={settings.feedIntervalHours}
              onChange={e => void saveSettings({ feedIntervalHours: Number(e.target.value) })}>
              {[2, 4, 6, 12, 24].map(h => <option key={h} value={h}>{h} hours</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1" style={{ color: 'var(--text-muted)' }}>
            <span className="text-xs">Morning briefing at</span>
            <select className={inputCls} style={inputStyle} value={settings.briefingHour}
              onChange={e => void saveSettings({ briefingHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1" style={{ color: 'var(--text-muted)' }}>
            <span className="text-xs">Kept items go to</span>
            <input className={inputCls} style={inputStyle} defaultValue={settings.feedNoteFolder}
              onBlur={e => e.target.value.trim() !== settings.feedNoteFolder && void saveSettings({ feedNoteFolder: e.target.value })} />
          </label>
        </div>
      </div>

      {/* Sources */}
      <div className="card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Sources</h2>
          <button onClick={() => setDraft({ ...EMPTY_DRAFT })} className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--primary)', color: 'white' }}>
            <Plus size={14} /> Add
          </button>
        </div>

        {sources.length === 0 && !draft && (
          <p className="text-sm py-2" style={{ color: 'var(--text-subtle)' }}>
            No sources yet. Add your own, or start from a suggestion below. Only the feed URL / arXiv query is sent out — never anything from your vault.
          </p>
        )}

        {sources.map(s => {
          const st = states[s.id]
          return (
            <div key={s.id} className="flex items-start gap-3 py-2.5 border-t first:border-t-0" style={{ borderColor: 'var(--border-subtle)' }}>
              <input type="checkbox" className="mt-1" checked={s.enabled} title={s.enabled ? 'Enabled' : 'Paused'}
                onChange={e => void save(sources.map(x => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)))} />
              <div className="flex-shrink-0 mt-0.5" style={{ color: 'var(--text-subtle)' }}>
                {s.kind === 'arxiv' ? <GraduationCap size={16} /> : <Rss size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: s.enabled ? 'var(--text)' : 'var(--text-subtle)' }}>{s.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--primary-tint)', color: 'var(--primary)' }}>{s.section}</span>
                </div>
                <p className="text-xs font-mono truncate mt-0.5" style={{ color: 'var(--text-subtle)' }}>{s.kind === 'arxiv' ? s.query : s.url}</p>
                <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: st?.lastError ? 'var(--danger)' : 'var(--text-subtle)' }}>
                  {st?.lastError && <AlertCircle size={12} />}
                  {st?.lastError ? `${ago(st.lastFetch)}: ${st.lastError}` : `${ago(st?.lastFetch ?? null)}${st?.lastFetch ? ` · ${st.lastCount ?? 0} new` : ''}`}
                </p>
              </div>
              <button onClick={() => setDraft({ ...s })} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label={`Edit ${s.name}`}><Pencil size={14} /></button>
              <button onClick={() => void save(sources.filter(x => x.id !== s.id))} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label={`Remove ${s.name}`}><Trash2 size={14} /></button>
            </div>
          )
        })}

        {draft && (
          <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
            <div className="flex gap-2">
              {(['arxiv', 'rss'] as const).map(k => (
                <button key={k} onClick={() => setDraft({ ...draft, kind: k })}
                  className="flex-1 text-sm px-3 py-1.5 rounded-lg border font-medium"
                  style={{ borderColor: draft.kind === k ? 'var(--primary)' : 'var(--border)', color: draft.kind === k ? 'var(--primary)' : 'var(--text-muted)', background: 'var(--bg-surface)' }}>
                  {k === 'arxiv' ? 'arXiv search' : 'RSS / Atom feed'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={inputCls} style={inputStyle} placeholder="Name" value={draft.name ?? ''} onChange={e => setDraft({ ...draft, name: e.target.value })} />
              <input className={inputCls} style={inputStyle} placeholder="Section (e.g. research, work)" list="inbox-sections"
                value={draft.section ?? ''} onChange={e => setDraft({ ...draft, section: e.target.value })} />
              <datalist id="inbox-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            {draft.kind === 'arxiv' ? (
              <div className="flex flex-col gap-1">
                <input className={`${inputCls} font-mono`} style={inputStyle} placeholder='cat:cs.IR AND abs:"retrieval augmented"'
                  value={draft.query ?? ''} onChange={e => setDraft({ ...draft, query: e.target.value })} />
                <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                  Fields: <code>ti:</code> title, <code>abs:</code> abstract, <code>au:</code> author, <code>cat:</code> category (cs.AI, cs.CL, cs.IR…); combine with AND / OR / ANDNOT.{' '}
                  <a href="https://info.arxiv.org/help/api/user-manual.html#query_details" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>Syntax</a>
                </p>
              </div>
            ) : (
              <input className={inputCls} style={inputStyle} placeholder="https://example.com/feed.xml" value={draft.url ?? ''} onChange={e => setDraft({ ...draft, url: e.target.value })} />
            )}
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                Max per fetch
                <input type="number" min={5} max={100} className="w-20 rounded-lg border px-2 py-1 text-sm" style={inputStyle}
                  value={draft.maxItems ?? 30} onChange={e => setDraft({ ...draft, maxItems: Number(e.target.value) })} />
              </label>
              <div className="flex gap-2">
                <button onClick={() => setDraft(null)} className="text-sm px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                <button onClick={() => void submitDraft()} disabled={saving} className="text-sm font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                  style={{ background: 'var(--primary)', color: 'white' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {unusedPresets.length > 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>Suggestions</p>
            <div className="flex flex-wrap gap-2">
              {unusedPresets.map(p => (
                <button key={p.name} onClick={() => void save([...sources, { ...p, enabled: true, maxItems: 30 } as Source])}
                  className="text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                  <Plus size={12} /> {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
