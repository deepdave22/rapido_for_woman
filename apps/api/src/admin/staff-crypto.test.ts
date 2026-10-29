import { randomBytes } from 'node:crypto';
import {
  base32Decode,
  base32Encode,
  decryptField,
  encryptField,
  hashPassword,
  matchTotpStep,
  passwordProblem,
  totpAt,
  verifyPassword,
  verifyTotp,
} from './staff-crypto';

describe('TOTP (RFC 6238 test vectors, SHA-1)', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('at %i gives %s', (t, expected) => {
    expect(totpAt(secret, t, 8)).toBe(expected);
  });

  it('verifies within one step of drift and rejects older codes', () => {
    const b32 = base32Encode(secret);
    const now = 1_700_000_000_000;
    const code = totpAt(secret, now / 1000);
    expect(verifyTotp(b32, code, now)).toBe(true);
    expect(verifyTotp(b32, code, now + 30_000)).toBe(true);
    expect(verifyTotp(b32, code, now + 90_000)).toBe(false);
    expect(verifyTotp(b32, 'abc123', now)).toBe(false);
  });

  it('reports the matched time step', () => {
    const b32 = base32Encode(secret);
    const now = 1_700_000_010_000;
    expect(matchTotpStep(b32, totpAt(secret, now / 1000), now)).toBe(Math.floor(now / 1000 / 30));
    expect(matchTotpStep(b32, '000000', now)).toBeNull();
  });

  it('round-trips base32 (RFC 4648 vector)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
  });
});

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct horse 42 battery');
    const b = await hashPassword('correct horse 42 battery');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse 42 battery', a)).toBe(true);
    expect(await verifyPassword('wrong horse 42 battery', a)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('enforces a minimum policy', () => {
    expect(passwordProblem('short1')).toMatch(/12/);
    expect(passwordProblem('onlyletterslong')).toMatch(/letters and numbers/);
    expect(passwordProblem('letters and 123')).toBeNull();
  });
});

describe('field encryption', () => {
  it('round-trips and detects tampering', () => {
    const key = randomBytes(32);
    const enc = encryptField(key, 'JBSWY3DPEHPK3PXP');
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptField(key, enc)).toBe('JBSWY3DPEHPK3PXP');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptField(key, parts.join('.'))).toThrow();
    expect(() => decryptField(randomBytes(32), enc)).toThrow();
  });
});
