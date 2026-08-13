import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, generateCode, verifyCode } from '../src/auth/totp.js'

describe('base32', () => {
  it('round-trips', () => {
    const input = Buffer.from('Hello, authenticator!')
    expect(base32Decode(base32Encode(input))).toEqual(input)
  })

  it('matches RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar')
  })

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW6YTB01')).toThrow(/Invalid base32/)
  })
})

/**
 * RFC 6238 Appendix B, SHA-1 rows. The published vectors use the ASCII secret
 * "12345678901234567890"; base32 of that is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
 * These are the canonical check that our implementation interoperates with
 * Google Authenticator, Authy and 1Password.
 */
describe('TOTP against RFC 6238 test vectors', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))

  const vectors: [seconds: number, code: string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ]

  for (const [seconds, expected] of vectors) {
    it(`t=${seconds} produces ${expected}`, () => {
      expect(generateCode(secret, seconds)).toBe(expected)
    })
  }
})

describe('verifyCode', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))

  it('accepts the current code', () => {
    expect(verifyCode(secret, generateCode(secret))).toBe(true)
  })

  it('accepts one step of clock drift either way', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(verifyCode(secret, generateCode(secret, now - 30))).toBe(true)
    expect(verifyCode(secret, generateCode(secret, now + 30))).toBe(true)
  })

  it('rejects a code two steps away', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(verifyCode(secret, generateCode(secret, now - 90))).toBe(false)
  })

  it('rejects malformed input without throwing', () => {
    expect(verifyCode(secret, '')).toBe(false)
    expect(verifyCode(secret, 'abcdef')).toBe(false)
    expect(verifyCode(secret, '12345')).toBe(false)
    expect(verifyCode(secret, '1234567')).toBe(false)
  })
})
