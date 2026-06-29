import type { MetadataRoute } from 'next'

// Web App Manifest so the app can be installed to a phone's home screen and
// launched standalone (no browser chrome) — a thin client to the laptop server.
// No service worker / offline cache: it only works while the laptop is running,
// so there's nothing useful to cache.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vault UI — Knowledge Steering',
    short_name: 'Vault UI',
    description: 'Local RAG + curation for your Obsidian vault',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0b0f',
    theme_color: '#0b0b0f',
    icons: [
      // Maskable SVG scales to any launcher size without separate raster assets.
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
