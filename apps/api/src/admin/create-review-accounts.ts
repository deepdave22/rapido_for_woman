import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { normalizeIndianMobile } from '@saheli/domain';
import { Pool } from 'pg';
import { validateEnv } from '../config/env';
import { createDatabase } from '../database/database.module';
import { provisionReviewAccounts, ReviewCategory } from './review-accounts';

/**
 * Creates or refreshes the app-store reviewer accounts (docs/MOBILE_RELEASE.md).
 * Usage: npm run review:accounts -w @saheli/api -- --passenger +91… --driver +91… [--category AUTO]
 */
async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { values } = parseArgs({
    options: {
      passenger: { type: 'string' },
      driver: { type: 'string' },
      category: { type: 'string', default: 'AUTO' },
    },
  });
  if (!values.passenger && !values.driver) {
    console.error(
      'Usage: review:accounts --passenger +91… --driver +91… [--category BIKE|AUTO|CAB]',
    );
    process.exit(1);
  }
  if (!['BIKE', 'AUTO', 'CAB'].includes(values.category!)) {
    console.error('--category must be BIKE, AUTO or CAB');
    process.exit(1);
  }
  const env = validateEnv(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const result = await provisionReviewAccounts(createDatabase(pool), {
      passengerPhone: values.passenger,
      driverPhone: values.driver,
      category: values.category as ReviewCategory,
    });
    console.log('Review accounts ready:', result);
    const listed = env.reviewLoginPhones;
    for (const phone of [values.passenger, values.driver]) {
      if (phone && !listed.has(normalizeIndianMobile(phone))) {
        console.warn(
          `Note: ${phone} is not in REVIEW_LOGIN_PHONES (or REVIEW_LOGIN_CODE is unset), so it gets normal SMS codes.`,
        );
      }
    }
  } finally {
    await pool.end();
  }
}

void main().catch((err: unknown) => {
  const cause = err instanceof Error && err.cause instanceof Error ? `\n${err.cause.message}` : '';
  console.error(err instanceof Error ? `${err.message}${cause}` : err);
  process.exit(1);
});
