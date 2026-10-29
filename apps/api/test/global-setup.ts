import { Pool } from 'pg';
import { runMigrations } from '../src/database/migrate';
import { TEST_ENV } from './test-env';

/** Rebuilds the test database from migrations once per run. */
export default async function setup(): Promise<void> {
  const url = TEST_ENV.DATABASE_URL!;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
  await runMigrations(url);
}
