// Score retrieval strategies on your vault (app must be running).
//   npm run eval:retrieval            # generate questions once (if none), then run
//   npm run eval:retrieval -- --regen # rebuild the question set first
// Override the app URL with VAULT_UI_URL (default http://127.0.0.1:3000).
const base = process.env.VAULT_UI_URL || 'http://127.0.0.1:3000'
const regen = process.argv.includes('--regen')

async function call(method, body) {
  const res = await fetch(`${base}/api/index/eval`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

const status = await call('GET')
if (regen || status.items === 0) {
  console.log('Generating eval questions with the local model (one-off, a few minutes)…')
  const g = await call('POST', { action: 'generate', n: 30 })
  console.log(`  ${g.items} questions, e.g.:`)
  for (const s of g.sample) console.log(`   - ${s.q}  →  ${s.expect[0]}`)
}

console.log('\nScoring strategies…')
const r = await call('POST', { action: 'run' })
console.log(`\n${r.n} questions · embed ${r.embedModel} · rerank ${r.rerankModel || '(off)'}\n`)
console.log('strategy             hit@1  hit@3  hit@5  MRR@10   ms/query')
for (const [name, s] of Object.entries(r.strategies)) {
  console.log(`${name.padEnd(20)} ${s.hit1.toFixed(2).padStart(5)}  ${s.hit3.toFixed(2).padStart(5)}  ${s.hit5.toFixed(2).padStart(5)}  ${s.mrr10.toFixed(3).padStart(6)}  ${String(s.avgMs).padStart(9)}`)
}
