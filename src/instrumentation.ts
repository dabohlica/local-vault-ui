// Runs once when the Next.js server starts. Boots the server-side caretaking
// scheduler (and, through it, the live-indexing watcher) so background work
// doesn't depend on a browser tab being open. The NEXT_RUNTIME check must wrap
// the import (not early-return) so the edge bundle drops the Node-only code.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/lib/scheduler')
    startScheduler()
  }
}
