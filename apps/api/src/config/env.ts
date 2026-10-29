import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/** OTP delivery. `console` and `memory` never send an SMS and are refused outside dev/test. */
export const OTP_PROVIDERS = ['console', 'memory', 'msg91'] as const;
export type OtpProvider = (typeof OTP_PROVIDERS)[number];

export const MAPS_PROVIDERS = ['estimate', 'google'] as const;
export type MapsProvider = (typeof MAPS_PROVIDERS)[number];

export const STORAGE_PROVIDERS = ['local', 's3'] as const;

export const PAYMENT_PROVIDERS = ['sandbox', 'razorpay'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

export class Env {
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsUrl({ protocols: ['postgres', 'postgresql'], require_tld: false })
  DATABASE_URL: string;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  DATABASE_POOL_MAX = 10;

  @IsUrl({ protocols: ['redis', 'rediss'], require_tld: false })
  REDIS_URL: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @Transform(toInt)
  @IsInt()
  @Min(60)
  @Max(3600)
  JWT_ACCESS_TTL_SECONDS = 900;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(90)
  REFRESH_TOKEN_TTL_DAYS = 30;

  /** Secret key for hashing OTP codes and refresh tokens at rest. */
  @IsString()
  @MinLength(32)
  HASH_PEPPER: string;

  @IsIn(OTP_PROVIDERS)
  OTP_PROVIDER: OtpProvider = 'console';

  @Transform(toInt)
  @IsInt()
  @Min(60)
  @Max(900)
  OTP_TTL_SECONDS = 300;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(10)
  OTP_MAX_ATTEMPTS = 5;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(20)
  OTP_MAX_SENDS_PER_PHONE_PER_HOUR = 5;

  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(300)
  OTP_RESEND_COOLDOWN_SECONDS = 30;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(1000)
  OTP_MAX_SENDS_PER_IP_PER_HOUR = 30;

  /** Comma-separated list of allowed browser origins (admin dashboard). */
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  /** Number of reverse-proxy hops to trust for client IPs (0 = none). */
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS = 0;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL = 'info';

  /** `estimate` = straight-line distance × road factor. Development only. */
  @IsIn(MAPS_PROVIDERS)
  MAPS_PROVIDER: MapsProvider = 'estimate';

  @IsOptional()
  @IsString()
  GOOGLE_MAPS_API_KEY?: string;

  /** `local` = files on this machine's disk. Development only. */
  @IsIn(STORAGE_PROVIDERS)
  STORAGE_PROVIDER: StorageProvider = 'local';

  @IsString()
  STORAGE_LOCAL_DIR = '.storage';

  /** Terms version passengers must accept before booking. */
  @IsString()
  TERMS_VERSION = '2026-10-draft';

  @Transform(toInt)
  @IsInt()
  @Min(60)
  @Max(900)
  QUOTE_TTL_SECONDS = 300;

  @Transform(toInt)
  @IsInt()
  @Min(5)
  @Max(60)
  DISPATCH_OFFER_TIMEOUT_SECONDS = 15;

  /** Comma-separated search radius per dispatch round, in metres. */
  @Matches(/^\d{3,5}(,\d{3,5}){0,5}$/)
  DISPATCH_RADII_METERS = '2000,4000,6000';

  /** A driver location older than this is not used for dispatch. */
  @Transform(toInt)
  @IsInt()
  @Min(10)
  @Max(300)
  LOCATION_MAX_AGE_SECONDS = 60;

  /** How often expired offers are swept. 0 disables the background loop (tests drive it). */
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(60000)
  DISPATCH_SWEEP_INTERVAL_MS = 2000;

  /** How long a ride keeps searching (retrying the widest radius) before NO_DRIVER_FOUND. */
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(600)
  DISPATCH_SEARCH_WINDOW_SECONDS = 90;

  /** 32 random bytes, base64. Encrypts sensitive fields at rest (staff TOTP secrets). */
  @IsString()
  @Matches(/^[A-Za-z0-9+/_-]{43}=?$/, { message: 'DATA_ENCRYPTION_KEY must be 32 bytes, base64' })
  DATA_ENCRYPTION_KEY: string;

  get dataEncryptionKey(): Buffer {
    return Buffer.from(this.DATA_ENCRYPTION_KEY, 'base64');
  }

  /** `sandbox` never moves money; staging/production refuse it. */
  @IsIn(PAYMENT_PROVIDERS)
  PAYMENT_PROVIDER: PaymentProviderName = 'sandbox';

  @IsOptional()
  @IsString()
  RAZORPAY_KEY_ID?: string;

  @IsOptional()
  @IsString()
  RAZORPAY_KEY_SECRET?: string;

  @IsOptional()
  @IsString()
  RAZORPAY_WEBHOOK_SECRET?: string;

  /** Signs sandbox webhooks so tests exercise the same verification path as production. */
  @IsString()
  @MinLength(16)
  SANDBOX_WEBHOOK_SECRET = 'sandbox-webhook-secret-dev-only';

  /** Public base for trip-share links, e.g. https://saheli.in/t/ (token is appended). */
  @IsUrl({ require_tld: false })
  SHARE_LINK_BASE_URL = 'http://localhost:3000/v1/public/trips/';

  get dispatchRadii(): number[] {
    return this.DISPATCH_RADII_METERS.split(',').map(Number);
  }
}

/**
 * Validates environment variables at startup. Misconfiguration fails fast
 * instead of surfacing as a runtime error in the middle of a ride.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { exposeDefaultValues: true });
  const errors = validateSync(env, { whitelist: false, skipMissingProperties: false });
  if (errors.length) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  const deployed = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
  if (deployed && (env.OTP_PROVIDER === 'console' || env.OTP_PROVIDER === 'memory')) {
    throw new Error(
      `OTP_PROVIDER=${env.OTP_PROVIDER} cannot be used in ${env.NODE_ENV}: it does not send SMS`,
    );
  }
  if (deployed && env.MAPS_PROVIDER === 'estimate') {
    throw new Error(
      `MAPS_PROVIDER=estimate cannot be used in ${env.NODE_ENV}: it is not a real route`,
    );
  }
  if (env.MAPS_PROVIDER === 'google' && !env.GOOGLE_MAPS_API_KEY) {
    throw new Error('MAPS_PROVIDER=google requires GOOGLE_MAPS_API_KEY');
  }
  if (deployed && env.STORAGE_PROVIDER === 'local') {
    throw new Error(
      `STORAGE_PROVIDER=local cannot be used in ${env.NODE_ENV}: identity documents need private object storage`,
    );
  }
  if (deployed && env.PAYMENT_PROVIDER === 'sandbox') {
    throw new Error(
      `PAYMENT_PROVIDER=sandbox cannot be used in ${env.NODE_ENV}: it does not move money`,
    );
  }
  if (
    env.PAYMENT_PROVIDER === 'razorpay' &&
    !(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET)
  ) {
    throw new Error(
      'PAYMENT_PROVIDER=razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET',
    );
  }
  if (env.OTP_PROVIDER === 'memory' && env.NODE_ENV !== 'test') {
    throw new Error('OTP_PROVIDER=memory is for automated tests only');
  }
  return env;
}
