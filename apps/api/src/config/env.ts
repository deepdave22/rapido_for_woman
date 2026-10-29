import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
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
  if (env.OTP_PROVIDER === 'memory' && env.NODE_ENV !== 'test') {
    throw new Error('OTP_PROVIDER=memory is for automated tests only');
  }
  return env;
}
