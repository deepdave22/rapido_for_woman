import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { createDatabase } from '../database/database.module';
import { staffRoleAssignments, staffUsers } from '../database/schema';
import { hashPassword } from './staff-crypto';

/**
 * Bootstraps the first super administrator (no shared credentials: one per
 * person). Usage: npm run admin:create -w @saheli/api -- someone@example.com "Full Name"
 * Prints a one-time temporary password; MFA is set up at first sign-in.
 */
async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const [email, fullName] = process.argv.slice(2);
  if (!email || !fullName) {
    console.error('Usage: admin:create <email> "<full name>"');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const db = createDatabase(pool);
    const password = `${randomBytes(12).toString('base64url')}7a`;
    const [staff] = await db
      .insert(staffUsers)
      .values({ email, fullName, passwordHash: await hashPassword(password) })
      .returning({ id: staffUsers.id });
    await db.insert(staffRoleAssignments).values({ staffUserId: staff!.id, role: 'SUPER_ADMIN' });
    console.log(`Created super administrator ${email}`);
    console.log(`Temporary password (shown once): ${password}`);
  } finally {
    await pool.end();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
