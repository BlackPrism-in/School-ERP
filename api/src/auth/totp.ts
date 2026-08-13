import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * RFC 6238 TOTP with RFC 4648 base32 secrets — the scheme every authenticator
 * app implements. Written out rather than pulled from a dependency: it is
 * ~60 lines of well-specified arithmetic, it is verified against the RFC test
 * vectors in tests/totp.test.ts, and MFA for admin accounts is not somewhere
 * to add unaudited supply-chain surface.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DIGITS = 6
const PERIOD_SECONDS = 30

export function generateSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength))
}

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function generateCode(secret: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  const counter = Math.floor(atSeconds / PERIOD_SECONDS)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', base32Decode(secret)).update(counterBuf).digest()
  // Dynamic truncation, RFC 4226 §5.4
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Accepts the current step plus `window` steps either side, absorbing clock
 * drift between the server and the user's phone. window=1 means ±30s.
 */
export function verifyCode(secret: string, code: string, window = 1): boolean {
  const candidate = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(candidate)) return false

  const now = Math.floor(Date.now() / 1000)
  for (let step = -window; step <= window; step += 1) {
    const expected = generateCode(secret, now + step * PERIOD_SECONDS)
    const a = Buffer.from(expected)
    const b = Buffer.from(candidate)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return false
}

/** otpauth:// URI for the QR code shown during enrolment. */
export function provisioningUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase()
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`
  })
}
