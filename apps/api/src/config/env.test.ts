import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  HASH_PEPPER: 'y'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults and converts numbers', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
  });

  it('rejects short secrets and missing URLs', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it.each(['staging', 'production'])('refuses the console OTP sender in %s', (NODE_ENV) => {
    expect(() => validateEnv({ ...base, NODE_ENV, OTP_PROVIDER: 'console' })).toThrow(
      /does not send SMS/,
    );
  });

  it('allows the in-memory OTP sender only in tests', () => {
    expect(() => validateEnv({ ...base, OTP_PROVIDER: 'memory' })).toThrow(/automated tests only/);
    expect(validateEnv({ ...base, NODE_ENV: 'test', OTP_PROVIDER: 'memory' }).OTP_PROVIDER).toBe(
      'memory',
    );
  });
});
