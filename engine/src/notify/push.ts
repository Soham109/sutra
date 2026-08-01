import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  createSign,
  randomBytes,
} from 'node:crypto'

// Web Push, by hand: RFC 8291 (aes128gcm message encryption) and RFC 8292
// (VAPID). Both are small — four HKDF calls, one AES-GCM record, one ES256
// JWT — and node:crypto already ships every primitive, so a dependency would
// add a supply-chain surface to the one path that reaches members' phones
// without removing any of the code we would still have to understand. The
// RFC's published example is pinned as a test vector in test/notify.test.ts.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushSubscriptionInfo {
  endpoint: string
  /** the browser's P-256 public key, base64url, 65-byte uncompressed point */
  p256dh: string
  /** the browser's 16-byte auth secret, base64url */
  auth: string
}

export type PushResult =
  | { ok: true; status: number }
  /** `gone` means the endpoint is dead (404/410) — delete the subscription. */
  | { ok: false; status: number | null; gone: boolean; reason: string }

export interface PushStatus {
  push_available: boolean
  reason?: string
  public_key?: string
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
}

/** Injectable so the Notifier can be tested, and mocked, without a network. */
export interface PushTransport {
  status(): PushStatus
  send(sub: PushSubscriptionInfo, payload: unknown): Promise<PushResult>
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const b64u = (b: Buffer): string => b.toString('base64url')
const unb64u = (s: string): Buffer => Buffer.from(s, 'base64url')

const hmac = (key: Buffer, data: Buffer): Buffer =>
  createHmac('sha256', key).update(data).digest()

/**
 * HKDF (RFC 5869). Every derivation web push needs is ≤32 bytes — one HMAC
 * block — so the expand counter never advances past 0x01.
 */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) throw new Error('hkdf: single-block expand only')
  return hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length)
}

/** RFC 8188 §2: one record, 4096 bytes, which is also the push size ceiling. */
const RECORD_SIZE = 4096

const CEK_INFO = Buffer.from('Content-Encoding: aes128gcm\0', 'ascii')
const NONCE_INFO = Buffer.from('Content-Encoding: nonce\0', 'ascii')
const KEY_INFO_PREFIX = Buffer.from('WebPush: info\0', 'ascii')

/**
 * RFC 8291 §3.1. Returns a complete aes128gcm body: the header carries the
 * salt and the ephemeral public key, because the browser needs both to derive
 * the same key and nothing else in the request is allowed to carry them.
 */
export function encryptPayload(
  plaintext: Buffer,
  keys: { p256dh: string; auth: string },
  // Fixed inputs exist only so the RFC's example is reproducible in a test.
  fixed?: { salt?: Buffer; serverPrivateKey?: Buffer },
): Buffer {
  const uaPublic = unb64u(keys.p256dh)
  const authSecret = unb64u(keys.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('p256dh must be a 65-byte uncompressed P-256 point')
  }
  if (authSecret.length !== 16) throw new Error('auth secret must be 16 bytes')
  if (plaintext.length + 17 > RECORD_SIZE) {
    throw new Error(`payload too large: ${plaintext.length} bytes, max ${RECORD_SIZE - 17}`)
  }

  const ecdh = createECDH('prime256v1')
  if (fixed?.serverPrivateKey) ecdh.setPrivateKey(fixed.serverPrivateKey)
  else ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const sharedSecret = ecdh.computeSecret(uaPublic)

  // The auth secret is the salt here, and the info string commits to both
  // public keys — that binding is what stops a push service from swapping in
  // its own ephemeral key and reading the message.
  const ikm = hkdf(
    authSecret,
    sharedSecret,
    Buffer.concat([KEY_INFO_PREFIX, uaPublic, asPublic]),
    32,
  )

  const salt = fixed?.salt ?? randomBytes(16)
  const cek = hkdf(salt, ikm, CEK_INFO, 16)
  const nonce = hkdf(salt, ikm, NONCE_INFO, 12)

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02 is RFC 8188's *last*-record delimiter; we always send exactly one.
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(asPublic.length, 20)
  return Buffer.concat([header, asPublic, sealed])
}

// ---------------------------------------------------------------------------
// VAPID (RFC 8292)
// ---------------------------------------------------------------------------

/** Print these once, put them in the environment, never rotate them casually:
 *  changing the public key invalidates every subscription already handed out. */
export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  // Pad: a scalar with leading zero bytes comes back short, and every consumer
  // of a VAPID private key expects exactly 32.
  const priv = Buffer.alloc(32)
  const raw = ecdh.getPrivateKey()
  raw.copy(priv, 32 - raw.length)
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(priv) }
}

interface VapidConfig {
  publicKey: string
  privateKey: Buffer
  subject: string
}

type VapidLoad = { ok: true; config: VapidConfig } | { ok: false; reason: string }

let cached: { key: string; load: VapidLoad } | null = null

/**
 * Read from the environment on every call rather than at import: the engine
 * boots in test and demo processes that set keys late, and a module-level
 * throw would take the whole server down over an optional feature.
 */
export function vapidConfig(): VapidLoad {
  const pub = process.env.VAPID_PUBLIC_KEY ?? ''
  const priv = process.env.VAPID_PRIVATE_KEY ?? ''
  const subject = process.env.VAPID_SUBJECT ?? ''
  const key = `${pub}|${priv}|${subject}`
  if (cached?.key === key) return cached.load
  const load = loadVapid(pub, priv, subject)
  cached = { key, load }
  return load
}

function loadVapid(pub: string, priv: string, subject: string): VapidLoad {
  if (!pub || !priv) {
    return { ok: false, reason: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set' }
  }
  try {
    const pubRaw = unb64u(pub)
    const privRaw = unb64u(priv)
    if (pubRaw.length !== 65 || pubRaw[0] !== 0x04) {
      return { ok: false, reason: 'VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 point' }
    }
    if (privRaw.length !== 32) {
      return { ok: false, reason: 'VAPID_PRIVATE_KEY must be a 32-byte P-256 scalar' }
    }
    // Prove the pair matches now rather than discovering it on the first push
    // to a real phone, where the failure is a silent 401 from a push service.
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(privRaw)
    if (!ecdh.getPublicKey().equals(pubRaw)) {
      return { ok: false, reason: 'VAPID public and private keys are not a pair' }
    }
    // RFC 8292 §2.1: `sub` must be a contact the push service can reach.
    const sub = subject || 'mailto:ops@sutra.local'
    if (!/^(mailto:|https?:\/\/)/.test(sub)) {
      return { ok: false, reason: 'VAPID_SUBJECT must be a mailto: or https: URL' }
    }
    return { ok: true, config: { publicKey: pub, privateKey: privRaw, subject: sub } }
  } catch (e) {
    return { ok: false, reason: `VAPID keys could not be parsed: ${(e as Error).message}` }
  }
}

/** Whether push can actually be attempted right now, and why not if it cannot. */
export function pushStatus(): PushStatus {
  const v = vapidConfig()
  return v.ok
    ? { push_available: true, public_key: v.config.publicKey }
    : { push_available: false, reason: v.reason }
}

/** RFC 8292 §2: a JWT the push service verifies against the `k` parameter. */
function vapidAuthorization(endpoint: string, cfg: VapidConfig): string {
  const aud = new URL(endpoint).origin
  // 12h, well inside the 24h ceiling: pushes are minutes old, and a short
  // window limits what a captured header can be replayed for.
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp, sub: cfg.subject })))
  const signingInput = `${header}.${claims}`

  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(cfg.privateKey)
  const point = ecdh.getPublicKey()
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: b64u(cfg.privateKey),
      x: b64u(point.subarray(1, 33)),
      y: b64u(point.subarray(33, 65)),
    },
  })
  // ES256 is raw r‖s, not the DER sequence createSign returns by default.
  const sig = createSign('sha256')
    .update(signingInput)
    .sign({ key, dsaEncoding: 'ieee-p1363' })

  return `vapid t=${signingInput}.${b64u(sig)}, k=${cfg.publicKey}`
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface SendOptions {
  /** seconds the push service may hold the message for a sleeping device */
  ttl?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  timeoutMs?: number
}

/**
 * Never throws. Every failure mode — unconfigured keys, a dead endpoint, a
 * push service having a bad day — comes back as a value, because the caller
 * is on the protocol path and has better things to do than catch.
 */
export async function sendPush(
  sub: PushSubscriptionInfo,
  payload: unknown,
  opts: SendOptions = {},
): Promise<PushResult> {
  const v = vapidConfig()
  if (!v.ok) return { ok: false, status: null, gone: false, reason: v.reason }

  let body: Buffer
  let authorization: string
  try {
    const plaintext = Buffer.from(
      typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}),
      'utf8',
    )
    body = encryptPayload(plaintext, sub)
    authorization = vapidAuthorization(sub.endpoint, v.config)
  } catch (e) {
    return { ok: false, status: null, gone: false, reason: `encrypt failed: ${(e as Error).message}` }
  }

  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(opts.ttl ?? 86400),
        urgency: opts.urgency ?? 'normal',
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    })
    if (res.ok) return { ok: true, status: res.status }
    // 404/410: the browser threw the subscription away and did not tell us.
    const gone = res.status === 404 || res.status === 410
    const detail = await res.text().catch(() => '')
    return {
      ok: false,
      status: res.status,
      gone,
      reason: `${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    }
  } catch (e) {
    return { ok: false, status: null, gone: false, reason: (e as Error).message }
  }
}

/** The real transport. Swap it in tests, or for a logging one on demo day. */
export const webPush: PushTransport = {
  status: pushStatus,
  send: (sub, payload) => sendPush(sub, payload),
}
