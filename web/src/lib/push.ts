'use client'

import { api } from '@/lib/api'

// Turning on notifications, from the browser's side.
//
// Every failure here is a sentence, never a silent false. Push is a stack of
// four things that can each be missing — a service worker, the Push API, a
// permission grant, and VAPID keys on the server — and a user staring at a
// toggle that does nothing deserves to be told which one it was.

const SW_URL = '/sw.js'

export interface PushSupport {
  supported: boolean
  /** why not, phrased for the person reading it */
  reason?: string
  /** iOS: the app has to be on the Home Screen before push exists at all */
  needsInstall?: boolean
}

export type PushOutcome =
  | { ok: true; endpoint: string }
  | { ok: false; reason: string; needsInstall?: boolean; permission?: NotificationPermission }

interface ServerStatus {
  push_available: boolean
  reason?: string
  public_key?: string
}

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof navigator !== 'undefined'

/** iPadOS 13+ reports itself as a Mac; the touch points are what give it away. */
function isApplePhoneOrTablet(): boolean {
  if (!isBrowser()) return false
  if (/iP(hone|ad|od)/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** True when running from the Home Screen copy rather than a Safari tab. */
function isStandalone(): boolean {
  if (!isBrowser()) return false
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return legacy || window.matchMedia('(display-mode: standalone)').matches
}

/**
 * Note the shape: this returns a reason, not a boolean, so `if
 * (pushSupported())` is always wrong — read `.supported`.
 */
export function pushSupported(): PushSupport {
  if (!isBrowser()) return { supported: false, reason: 'Not running in a browser.' }

  if (!window.isSecureContext) {
    return { supported: false, reason: 'Notifications need a secure connection (https or localhost).' }
  }
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: 'This browser has no service workers, so it cannot receive push.' }
  }
  if (!('PushManager' in window) || !('Notification' in window)) {
    // On iOS this is the normal state of a Safari tab: Apple exposes push only
    // to installed web apps, so the fix is an instruction, not an apology.
    if (isApplePhoneOrTablet() && !isStandalone()) {
      return {
        supported: false,
        needsInstall: true,
        reason:
          'On iPhone and iPad, notifications only work once Sutra is installed: tap Share, then "Add to Home Screen", and turn them on from there.',
      }
    }
    return { supported: false, reason: 'This browser does not support push notifications.' }
  }
  // iOS 16.3 and earlier have neither; anything newer in a tab is handled above.
  return { supported: true }
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!isBrowser() || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

// ---------------------------------------------------------------------------
// Enable / disable
// ---------------------------------------------------------------------------

/**
 * Must be called from a click handler: Safari only honours a permission
 * prompt that a user gesture asked for, and drops it silently otherwise.
 */
export async function enablePush(): Promise<PushOutcome> {
  const support = pushSupported()
  if (!support.supported) {
    return { ok: false, reason: support.reason ?? 'Push is unavailable.', needsInstall: support.needsInstall }
  }

  // Ask the engine first. If it has no VAPID keys there is no point burning
  // the one permission prompt the user will ever give us on this origin.
  let status: ServerStatus
  try {
    status = await api.get<ServerStatus>('/v1/notify/status')
  } catch (e) {
    return { ok: false, reason: `Could not reach the engine: ${message(e)}` }
  }
  if (!status.push_available || !status.public_key) {
    return {
      ok: false,
      reason: status.reason
        ? `Push is switched off on the server: ${status.reason}`
        : 'Push is switched off on the server.',
    }
  }

  if (Notification.permission === 'denied') {
    return {
      ok: false,
      permission: 'denied',
      reason: 'Notifications are blocked for this site. Re-allow them in your browser settings, then try again.',
    }
  }

  let registration: ServiceWorkerRegistration
  try {
    registration = await navigator.serviceWorker.register(SW_URL)
    // subscribe() throws if the worker is not active yet, which it is not on
    // the very first visit — the visit where someone taps the toggle.
    await navigator.serviceWorker.ready
  } catch (e) {
    return { ok: false, reason: `Could not start the notification worker: ${message(e)}` }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return {
      ok: false,
      permission,
      reason:
        permission === 'denied'
          ? 'You blocked notifications for this site.'
          : 'The permission prompt was dismissed, so nothing was turned on.',
    }
  }

  const applicationServerKey = base64UrlToBytes(status.public_key)

  let subscription: PushSubscription | null
  try {
    subscription = await registration.pushManager.getSubscription()
    // A subscription made against a different VAPID key is dead weight: the
    // browser refuses to re-subscribe over it, so drop it and start clean.
    if (subscription && !sameKey(subscription, applicationServerKey)) {
      await subscription.unsubscribe().catch(() => undefined)
      subscription = null
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        // Required by every browser: we promise each push shows a notification.
        userVisibleOnly: true,
        applicationServerKey,
      })
    }
  } catch (e) {
    return { ok: false, reason: `The browser refused to subscribe: ${message(e)}` }
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'The browser returned an incomplete subscription.' }
  }

  try {
    await api.post('/v1/notify/subscribe', {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    })
  } catch (e) {
    // The browser now holds a subscription the engine cannot use. Undo it, so
    // the next attempt is a clean subscribe rather than a silent dead endpoint.
    await subscription.unsubscribe().catch(() => undefined)
    return { ok: false, reason: `Could not register this device: ${message(e)}` }
  }

  return { ok: true, endpoint: json.endpoint }
}

/** Tell the engine first: a subscription it still holds would push into a void. */
export async function disablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isBrowser() || !('serviceWorker' in navigator)) return { ok: true }
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_URL)
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return { ok: true }
    await api.post('/v1/notify/unsubscribe', { endpoint: subscription.endpoint }).catch(() => undefined)
    await subscription.unsubscribe()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: message(e) }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The VAPID key travels as base64url and must reach pushManager.subscribe as
 * raw bytes — handing it the string is the single most common way this whole
 * feature silently fails.
 */
function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=')
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  // Backed by an explicit ArrayBuffer: subscribe() wants a BufferSource, and
  // a plain `new Uint8Array(n)` is typed over SharedArrayBuffer too.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function sameKey(subscription: PushSubscription, key: Uint8Array<ArrayBuffer>): boolean {
  const existing = subscription.options?.applicationServerKey
  if (!existing) return false
  const bytes = new Uint8Array(existing as ArrayBuffer)
  return bytes.length === key.length && bytes.every((b, i) => b === key[i])
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
