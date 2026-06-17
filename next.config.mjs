/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native / CJS node modules out of the server bundle so they load at runtime.
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'pdf-parse'],
  },
}

export default nextConfig
