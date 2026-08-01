import type { NextConfig } from 'next'

const ENGINE = process.env.ENGINE_URL ?? 'http://localhost:4100'

const config: NextConfig = {
  reactStrictMode: true,
  // The browser talks to /api/* on its own origin; Next proxies to the engine.
  // Keeps cookies first-party and means no CORS or mixed-content surprises
  // when the engine sits on a different host in production.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${ENGINE}/:path*` }]
  },
  images: {
    // Product images come from arbitrary merchants — that is the whole point.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
}

export default config
