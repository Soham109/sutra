import type { NextConfig } from 'next'

const ENGINE = process.env.ENGINE_URL ?? 'http://localhost:4100'

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * One public origin.
   *
   * The engine's `APP_BASE_URL` is this app, so every absolute URL it puts in a
   * discovery document — the A2A card, AgentFacts, the AI catalog, SKILL.md —
   * points here. That was a lie until now: only `/api/*` was proxied, so an
   * agent that read our listing and followed the advertised base URL got a 404
   * on every hop of the chain.
   *
   * These rewrites make the claim true. The alternative was to re-point
   * `APP_BASE_URL` at the engine host, but then every per-member approval link
   * would open the engine's plain fallback HTML instead of the real app, which
   * is the surface the whole demo runs on.
   */
  async rewrites() {
    return {
      // `beforeFiles` outranks the app router, which is required here: the AI
      // catalog lives at `/api/agents`, and `app/api/[...path]/route.ts` would
      // otherwise swallow it and forward to `<engine>/agents`, which is a 404.
      beforeFiles: [{ source: '/api/agents', destination: `${ENGINE}/api/agents` }],
      afterFiles: [
        { source: '/.well-known/:path*', destination: `${ENGINE}/.well-known/:path*` },
        { source: '/agent-facts.json', destination: `${ENGINE}/agent-facts.json` },
        { source: '/skill.md', destination: `${ENGINE}/skill.md` },
        { source: '/openapi.json', destination: `${ENGINE}/openapi.json` },
        { source: '/health', destination: `${ENGINE}/health` },
        // The public GMP/1 contract, reachable at the base URL SKILL.md quotes.
        // Deliberately NOT routed through `app/api/[...path]`, which injects our
        // server-side token: an agent calling /v1 presents its own bearer, and
        // that header passes through a rewrite untouched.
        { source: '/v1/:path*', destination: `${ENGINE}/v1/:path*` },
      ],
    }
  },

  images: {
    // Product images come from arbitrary merchants — that is the whole point.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
}

export default config
