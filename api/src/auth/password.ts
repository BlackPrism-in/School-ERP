import { hash, verify } from '@node-rs/argon2'
import { z } from 'zod'

/**
 * OWASP Password Storage Cheat Sheet, Argon2id row: 19 MiB memory, 2
 * iterations, parallelism 1. Tuned upward only with a benchmark — a hash that
 * takes 500ms turns the login endpoint into its own denial of service.
 */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS)
}

export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext, OPTIONS)
  } catch {
    // A malformed or truncated hash in the database must read as "wrong
    // password", never as a 500 that tells an attacker something is unusual.
    return false
  }
}

/**
 * NIST SP 800-63B: length is what matters, composition rules are not
 * required and push users toward predictable substitutions. We enforce a
 * floor of 12, a ceiling to bound hashing cost, and block the handful of
 * passwords a school account will actually be attacked with.
 */
const BANNED = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'demo@123', 'admin@123',
  'welcome1', 'welcome123', 'qwerty123', 'letmein123', '123456789012',
  'school@123', 'teacher@123', 'student@123', 'changeme123',
])

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((v) => !BANNED.has(v.toLowerCase()), 'That password is too easily guessed.')
  .refine((v) => new Set(v).size >= 5, 'Password is too repetitive.')

/**
 * Constant-time-ish equality for short opaque tokens. Node's timingSafeEqual
 * throws on length mismatch, which itself leaks length, so compare digests of
 * equal size only.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
