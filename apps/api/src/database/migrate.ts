import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabase } from './database.module';

/** Applies pending migrations in order. Safe to run repeatedly. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(createDatabase(pool), {
      migrationsFolder: join(__dirname, '..', '..', 'drizzle'),
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrations applied'))
    .catch((err: unknown) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
