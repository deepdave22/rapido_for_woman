import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  HASH_PEPPER: 'y'.repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
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

  it('allows the in-memory push sender only in tests', () => {
    expect(() => validateEnv({ ...base, PUSH_PROVIDER: 'memory' })).toThrow(/automated tests only/);
    expect(validateEnv({ ...base, PUSH_PROVIDER: 'expo' }).PUSH_PROVIDER).toBe('expo');
  });

  it('validates app-link signing details', () => {
    const fp = Array.from({ length: 32 }, () => 'AB').join(':');
    expect(
      validateEnv({ ...base, ANDROID_APP_LINK_SHA256: `${fp},${fp}` }).ANDROID_APP_LINK_SHA256,
    ).toBe(`${fp},${fp}`);
    expect(() => validateEnv({ ...base, ANDROID_APP_LINK_SHA256: 'AB:CD' })).toThrow(
      /ANDROID_APP_LINK_SHA256/,
    );
    expect(() => validateEnv({ ...base, IOS_TEAM_ID: 'short' })).toThrow(/IOS_TEAM_ID/);
  });
});
