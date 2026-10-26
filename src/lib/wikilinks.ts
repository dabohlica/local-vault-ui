// [[wikilinks]] in model answers → markdown links to the notes they name.
// Pure (no Node imports) so the chat page can use it and tests can cover it.

export const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '')
export const noteHref = (p: string) => `/explorer?file=${encodeURIComponent(p)}`

// [[Note]] in an answer → a link to that note (cited notes first, then any note
// with that path or name), else just bold.
export function linkWikilinks(text: string, citations: Array<{ path: string }> = [], notes: string[] = []): string {
  return text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => {
    const t = target.trim()
    const label = alias?.trim() || titleOf(t)
    const want = t.toLowerCase().replace(/\.md$/, '')
    const pool = [...citations.map(c => c.path), ...notes]
    const hit = pool.find(p => p.toLowerCase().replace(/\.md$/, '') === want)
      ?? pool.find(p => titleOf(p).toLowerCase() === titleOf(want))
    return hit ? `[${label}](${noteHref(hit)})` : `**${label}**`
  })
}
