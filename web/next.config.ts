import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    // Product images come from arbitrary merchants — that is the whole point.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
}

export default config
