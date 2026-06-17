import type { Metadata } from 'next'
import './globals.css'
import { ToastProvider } from '@/components/shared/Toast'
import { AppShell } from '@/components/layout/AppShell'

export const metadata: Metadata = {
  title: 'Vault UI — Knowledge Steering',
  description: 'Personal knowledge vault steering interface',
}

// Runs before paint to apply the saved theme (light default) without a flash.
const THEME_INIT = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="font-sans min-h-screen">
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  )
}
