import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ledgerEntries } from '../src/database/schema';
import { createTestApp, pgError, resetDatabase, TestContext } from './helpers';

/** Invariants the database enforces on its own, independent of application code. */
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
});

describe('financial ledger', () => {
  it('accepts a balanced transaction', async () => {
    const transactionId = randomUUID();
    await ctx.db.transaction(async (tx) => {
      await tx.insert(ledgerEntries).values([
        {
          transactionId,
          account: 'GATEWAY_CLEARING',
          direction: 'DEBIT',
          amountPaise: 13800,
          description: 'test',
        },
        {
          transactionId,
          account: 'DRIVER_PAYABLE',
          direction: 'CREDIT',
          amountPaise: 10080,
          description: 'test',
        },
        {
          transactionId,
          account: 'PLATFORM_REVENUE',
          direction: 'CREDIT',
          amountPaise: 3065,
          description: 'test',
        },
        {
          transactionId,
          account: 'TAX_PAYABLE',
          direction: 'CREDIT',
          amountPaise: 655,
          description: 'test',
        },
      ]);
    });
    const [row] = await ctx.db
      .execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM financial_ledger_entries`)
      .then((r) => r.rows);
    expect(row!.n).toBe(4);
  });

  it('rejects an unbalanced transaction at commit', async () => {
    const transactionId = randomUUID();
    await expect(
      ctx.db.transaction(async (tx) => {
        await tx.insert(ledgerEntries).values([
          {
            transactionId,
            account: 'GATEWAY_CLEARING',
            direction: 'DEBIT',
            amountPaise: 13800,
            description: 'test',
          },
          {
            transactionId,
            account: 'DRIVER_PAYABLE',
            direction: 'CREDIT',
            amountPaise: 13700,
            description: 'test',
          },
        ]);
      }),
    ).rejects.toThrow();
    const { rows } = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM financial_ledger_entries`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('refuses to update or delete posted entries', async () => {
    const transactionId = randomUUID();
    await ctx.db.insert(ledgerEntries).values([
      {
        transactionId,
        account: 'GATEWAY_CLEARING',
        direction: 'DEBIT',
        amountPaise: 500,
        description: 'test',
      },
      {
        transactionId,
        account: 'PLATFORM_REVENUE',
        direction: 'CREDIT',
        amountPaise: 500,
        description: 'test',
      },
    ]);
    expect(
      await pgError(ctx.db.execute(sql`UPDATE financial_ledger_entries SET amount_paise = 1`)),
    ).toMatch(/append-only/);
    expect(await pgError(ctx.db.execute(sql`DELETE FROM financial_ledger_entries`))).toMatch(
      /append-only/,
    );
  });

  it('rejects zero and negative amounts', async () => {
    await expect(
      ctx.db.insert(ledgerEntries).values({
        transactionId: randomUUID(),
        account: 'PLATFORM_REVENUE',
        direction: 'CREDIT',
        amountPaise: -1,
        description: 'test',
      }),
    ).rejects.toThrow();
  });
});

describe('audit log', () => {
  it('is append-only', async () => {
    await ctx.db.execute(
      sql`INSERT INTO audit_logs (actor_type, action, entity_type) VALUES ('SYSTEM', 'test', 'test')`,
    );
    expect(await pgError(ctx.db.execute(sql`DELETE FROM audit_logs`))).toMatch(/append-only/);
  });
});

describe('users', () => {
  it('only stores valid Indian mobile numbers', async () => {
    await expect(
      ctx.db.execute(sql`INSERT INTO users (phone_e164) VALUES ('+14155550123')`),
    ).rejects.toThrow();
  });
});
