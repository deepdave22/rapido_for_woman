import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Keyed hash for secrets stored at rest (OTP codes, refresh tokens). */
export function keyedHash(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Cryptographically random numeric code, zero-padded. */
export function randomDigits(length: number): string {
  return String(randomInt(0, 10 ** length)).padStart(length, '0');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
