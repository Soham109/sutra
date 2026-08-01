import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from 'next/font/google'
import './globals.css'

// Instrument Sans carries the UI, Bricolage takes the landing's big statements,
// and Plex Mono is structural — it sets every amount, id, hash and policy
// expression in the product.
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--f-sans',
  display: 'swap',
})
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--f-display',
  display: 'swap',
  axes: ['opsz'],
})
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--f-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'sutra — group checkout without the group treasurer',
  description:
    'Everyone approves their own share on their own card. The group commits together, or nobody is charged. Built on Prava mandates.',
  openGraph: {
    title: 'sutra — group checkout without the group treasurer',
    description: 'N people, N cards, one atomic commit. No pooled funds, nobody fronts the money.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf8' },
    { media: '(prefers-color-scheme: dark)', color: '#121110' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applied before paint so a dark-mode reload never flashes paper. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sutra-theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${sans.variable} ${display.variable} ${mono.variable}`}>{children}</body>
    </html>
  )
}
