/**
 * Environment for integration tests. Points at the dedicated `saheli_test`
 * database and Redis db 15 so tests never touch development data.
 */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgres://saheli:saheli_local_only@localhost:55432/saheli_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  JWT_ACCESS_SECRET: 'test-only-jwt-secret-0123456789abcdef',
  HASH_PEPPER: 'test-only-hash-pepper-0123456789abcdef',
  OTP_PROVIDER: 'memory',
  OTP_RESEND_COOLDOWN_SECONDS: '0',
  OTP_MAX_SENDS_PER_PHONE_PER_HOUR: '5',
  // Tests drive the dispatch sweeper explicitly.
  DISPATCH_SWEEP_INTERVAL_MS: '0',
  MAINTENANCE_INTERVAL_MS: '0',
  STORAGE_LOCAL_DIR: '.storage-test',
  TERMS_VERSION: 'test-terms-1',
  DATA_ENCRYPTION_KEY: 'dGVzdC1vbmx5LWRhdGEta2V5LTMyLWJ5dGVzLWxvbmc=',
};
