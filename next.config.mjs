/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native / CJS node modules out of the server bundle so they load at runtime.
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'pdf-parse'],
    // Enables src/instrumentation.ts (server-side caretaking scheduler). Stable
    // and on by default from Next 15; opt-in on 14.
    instrumentationHook: true,
  },
}

export default nextConfig
