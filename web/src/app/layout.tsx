import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/manrope'
import './globals.css'

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  applicationName: 'sutra',
  appleWebApp: { capable: true, title: 'sutra', statusBarStyle: 'black-translucent' },
  title: 'sutra — buy together, without the group bank',
  description:
    'Split any checkout before it is paid. Everyone approves their own share and the group commits together, or nobody is charged.',
  openGraph: {
    title: 'sutra — buy together, without the group bank',
    description: 'N people, N cards, one coordinated checkout. No pooled funds and nobody fronts the money.',
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
