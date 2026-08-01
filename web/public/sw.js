/* Sutra service worker — notifications only.
 *
 * No caching, no offline shell, no build step. This worker exists because the
 * Push API refuses to deliver anything without one: a push wakes the worker,
 * the worker draws the notification, and a tap brings the right screen forward.
 * Anything else it did would be another thing that can break the demo.
 */

// Take over on first load instead of waiting for every open tab to close —
// otherwise the person who just tapped "turn on notifications" has a worker
// that only starts controlling their next session.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const DEFAULT_TITLE = 'Sutra'

self.addEventListener('push', (event) => {
  // Push services are allowed to deliver a wake-up with no data at all, and
  // a worker that throws here shows the browser's own "site updated in the
  // background" notice — worse than anything we would have written.
  let data = {}
  if (event.data) {
    try {
      data = event.data.json()
    } catch {
      data = { body: event.data.text() }
    }
  }

  const title = data.title || DEFAULT_TITLE
  const url = data.url || '/'

  const options = {
    body: data.body || '',
    // Optional: the browser falls back to the site icon if these 404.
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    // Everything notificationclick needs, since the event carries no payload.
    data: { url, id: data.id || null, kind: data.kind || null },
    // Coalesce by destination: five updates about one group should replace
    // each other on the lock screen, not stack into a wall the user swipes away.
    tag: url,
    renotify: true,
    // The decisions this app sends are time-critical and short-lived; a
    // notification the user has to dismiss twice is a notification they mute.
    requireInteraction: false,
    timestamp: Date.parse(data.created_at || '') || Date.now(),
  }

  // waitUntil keeps the worker alive until the notification is actually drawn.
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const href = (event.notification.data && event.notification.data.url) || '/'
  const absolute = new URL(href, self.location.origin)

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Prefer a tab already on that exact screen, then any tab of ours:
        // opening a fourth Sutra window on someone's phone is not "focus".
        const exact = clients.find((c) => new URL(c.url).pathname === absolute.pathname)
        const open = exact || clients[0]
        if (!open) return self.clients.openWindow(absolute.href)
        if (exact) return open.focus()
        // navigate() before focus() so the tab is already right when it lands.
        // It rejects for clients this worker does not control — focus anyway,
        // a tab on the wrong screen still beats no tab.
        return open
          .navigate(absolute.href)
          .then((c) => (c || open).focus())
          .catch(() => open.focus())
      })
      .catch(() => self.clients.openWindow(absolute.href)),
  )
})
