import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/manrope'
import './globals.css'

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/sutra-mark.svg', type: 'image/svg+xml' }],
    shortcut: '/sutra-mark.svg',
    apple: '/sutra-mark.svg',
  },
  applicationName: 'sutra',
  appleWebApp: { capable: true, title: 'sutra', statusBarStyle: 'black-translucent' },
  title: 'sutra — buy together, without the group bank',
  description:
    'Coordinate a group purchase, collect person-scoped consent, and record the exact rail-specific outcome.',
  openGraph: {
    title: 'sutra — buy together, without the group bank',
    description: 'N people, one coordinated decision, no pooled wallet, and a signed rail-aware outcome.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f6f2' },
    { media: '(prefers-color-scheme: dark)', color: '#11110f' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sutra-theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
