import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'sutra — decide and split together',
    short_name: 'sutra',
    description: 'Plan, decide, split and approve together without one person becoming the group bank.',
    start_url: '/app',
    display: 'standalone',
    background_color: '#f4f0e8',
    theme_color: '#f7f4ed',
    orientation: 'portrait-primary',
    categories: ['finance', 'shopping', 'travel', 'lifestyle'],
    icons: [
      { src: '/sutra-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/sutra-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Start a plan', short_name: 'Plan', url: '/app/plan/new' },
      { name: 'Split a link', short_name: 'Split', url: '/app/discover' },
      { name: 'Scan a bill', short_name: 'Bill', url: '/app/bill' },
    ],
  }
}
