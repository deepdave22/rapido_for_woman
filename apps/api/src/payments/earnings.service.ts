import { Inject, Injectable } from '@nestjs/common';
import { FareBreakdown, settleFare } from '@saheli/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { DB, Database, Tx } from '../database/database.module';
import { driverPayouts } from '../database/schema';
import { LedgerService } from './ledger.service';

const IST_DATE = (col: string) => sql.raw(`(${col} AT TIME ZONE 'Asia/Kolkata')::date`);

export interface DriverBalance {
  /** Owed to the driver from fares and fees, less what has been paid out. */
  payablePaise: number;
  /** Cash collected from passengers that belongs to the platform. */
  cashHeldPaise: number;
  /** payable - cashHeld: positive = platform owes driver; negative = driver owes platform. */
  netPaise: number;
}

/** Driver earnings and payouts, derived only from the ledger. */
@Injectable()
export class EarningsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async balance(driverId: string, tx?: Tx): Promise<DriverBalance> {
    const { rows } = await (tx ?? this.db).execute<{ payable: number; cash: number }>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN account = 'DRIVER_PAYABLE'
          THEN CASE direction WHEN 'CREDIT' THEN amount_paise ELSE -amount_paise END END), 0)::int AS payable,
        COALESCE(SUM(CASE WHEN account = 'CASH_HELD_BY_DRIVER'
          THEN CASE direction WHEN 'DEBIT' THEN amount_paise ELSE -amount_paise END END), 0)::int AS cash
      FROM financial_ledger_entries
      WHERE owner_user_id = ${driverId} AND account IN ('DRIVER_PAYABLE', 'CASH_HELD_BY_DRIVER')`);
    const payable = Number(rows[0]?.payable ?? 0);
    const cash = Number(rows[0]?.cash ?? 0);
    return { payablePaise: payable, cashHeldPaise: cash, netPaise: payable - cash };
  }

  /** Earnings between two IST dates (inclusive). */
  async summary(driverId: string, from: string, to: string) {
    const { rows: days } = await this.db.execute<{
      day: string;
      trips: number;
      earnings: number;
      cash: number;
    }>(sql`
      SELECT ${IST_DATE('l.created_at')}::text AS day,
             COUNT(DISTINCT l.ride_id) FILTER (WHERE l.account = 'DRIVER_PAYABLE' AND l.direction = 'CREDIT')::int AS trips,
             COALESCE(SUM(l.amount_paise) FILTER (WHERE l.account = 'DRIVER_PAYABLE' AND l.direction = 'CREDIT'), 0)::int AS earnings,
             COALESCE(SUM(l.amount_paise) FILTER (WHERE l.account = 'CASH_HELD_BY_DRIVER' AND l.direction = 'DEBIT'), 0)::int AS cash
        FROM financial_ledger_entries l
       WHERE l.owner_user_id = ${driverId}
         AND l.ride_id IS NOT NULL
         AND ${IST_DATE('l.created_at')} BETWEEN ${from}::date AND ${to}::date
       GROUP BY 1 ORDER BY 1`);
    // Commission per completed, paid ride, via the same settlement used for the ledger.
    const { rows: fareRides } = await this.db.execute<{
      breakdown: FareBreakdown;
      bps: number;
    }>(sql`
      SELECT r.final_breakdown AS breakdown, pr.commission_rate_bps AS bps
        FROM rides r
        JOIN pricing_rules pr ON pr.id = r.pricing_rule_id
       WHERE r.driver_id = ${driverId}
         AND r.status = 'COMPLETED'
         AND r.final_breakdown IS NOT NULL
         AND EXISTS (SELECT 1 FROM financial_ledger_entries l
                      WHERE l.ride_id = r.id AND l.account = 'DRIVER_PAYABLE' AND l.direction = 'CREDIT'
                        AND ${IST_DATE('l.created_at')} BETWEEN ${from}::date AND ${to}::date)`);
    const settled = fareRides.map((r) => settleFare(r.breakdown, Number(r.bps)));
    const { rows: cancels } = await this.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM ride_events e
       WHERE e.actor_type = 'DRIVER' AND e.actor_id = ${driverId}
         AND e.to_status = 'SEARCHING'
         AND ${IST_DATE('e.created_at')} BETWEEN ${from}::date AND ${to}::date`);
    const payouts = await this.db
      .select()
      .from(driverPayouts)
      .where(eq(driverPayouts.driverId, driverId))
      .orderBy(sql`${driverPayouts.createdAt} DESC`)
      .limit(20);

    const daily = days.map((d) => ({
      date: d.day,
      trips: Number(d.trips),
      earningsPaise: Number(d.earnings),
      cashCollectedPaise: Number(d.cash),
    }));
    return {
      from,
      to,
      trips: daily.reduce((s, d) => s + d.trips, 0),
      earningsPaise: daily.reduce((s, d) => s + d.earningsPaise, 0),
      cashCollectedPaise: daily.reduce((s, d) => s + d.cashCollectedPaise, 0),
      grossFarePaise: fareRides.reduce((sum, r) => sum + r.breakdown.rideFarePaise, 0),
      commissionPaise: settled.reduce((sum, x) => sum + x.commissionPaise, 0),
      driverCancellations: Number(cancels[0]?.n ?? 0),
      balance: await this.balance(driverId),
      daily,
      payouts: payouts.map((p) => ({
        id: p.id,
        amountPaise: p.amountPaise,
        status: p.status,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        paidAt: p.paidAt,
        providerReference: p.providerReference,
      })),
    };
  }

  /** Per-ride CSV statement for the period (amounts in rupees). */
  async statementCsv(driverId: string, from: string, to: string): Promise<string> {
    const { rows } = await this.db.execute<{
      day: string;
      ride_id: string;
      method: string;
      fare: number | null;
      earning: number;
      cash: number;
    }>(sql`
      SELECT ${IST_DATE('l.created_at')}::text AS day, l.ride_id, r.payment_method AS method,
             r.final_total_paise AS fare,
             COALESCE(SUM(l.amount_paise) FILTER (WHERE l.account = 'DRIVER_PAYABLE' AND l.direction = 'CREDIT'), 0)::int AS earning,
             COALESCE(SUM(l.amount_paise) FILTER (WHERE l.account = 'CASH_HELD_BY_DRIVER' AND l.direction = 'DEBIT'), 0)::int AS cash
        FROM financial_ledger_entries l
        JOIN rides r ON r.id = l.ride_id
       WHERE l.owner_user_id = ${driverId}
         AND ${IST_DATE('l.created_at')} BETWEEN ${from}::date AND ${to}::date
       GROUP BY 1, 2, 3, 4 ORDER BY 1, 2`);
    const rupees = (p: number | null) => (p === null ? '' : (p / 100).toFixed(2));
    const lines = ['date,ride_id,payment_method,fare_inr,your_earning_inr,cash_collected_inr'];
    for (const r of rows) {
      lines.push(
        [
          r.day,
          r.ride_id,
          r.method,
          rupees(r.fare),
          rupees(Number(r.earning)),
          rupees(Number(r.cash)),
        ].join(','),
      );
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Creates a payout of everything currently owed. Cash the driver holds is
   * netted off first. Moves the amount to PAYOUT_CLEARING until confirmed paid.
   */
  async createPayout(staffId: string, driverId: string, periodStart: string, periodEnd: string) {
    const payout = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'payout:' + driverId}))`);
      const [open] = await tx
        .select({ id: driverPayouts.id })
        .from(driverPayouts)
        .where(
          and(
            eq(driverPayouts.driverId, driverId),
            inArray(driverPayouts.status, ['PENDING', 'PROCESSING']),
          ),
        );
      if (open)
        throw new AppError(
          409,
          'PAYOUT_IN_PROGRESS',
          'This driver already has a payout in progress',
        );
      const bal = await this.balance(driverId, tx);
      if (bal.netPaise <= 0) {
        throw new AppError(422, 'NOTHING_TO_PAY_OUT', 'Nothing is owed to this driver', {
          balance: bal,
        });
      }
      const [row] = await tx
        .insert(driverPayouts)
        .values({ driverId, amountPaise: bal.netPaise, periodStart, periodEnd, status: 'PENDING' })
        .returning();
      const cashOffset = Math.min(bal.cashHeldPaise, bal.payablePaise);
      if (cashOffset > 0) {
        await this.ledger.post(
          tx,
          [
            { account: 'DRIVER_PAYABLE', amount: cashOffset, ownerUserId: driverId },
            { account: 'CASH_HELD_BY_DRIVER', amount: -cashOffset, ownerUserId: driverId },
          ],
          { payoutId: row!.id, description: 'Net cash collected against earnings' },
        );
      }
      await this.ledger.post(
        tx,
        [
          { account: 'DRIVER_PAYABLE', amount: bal.netPaise, ownerUserId: driverId },
          { account: 'PAYOUT_CLEARING', amount: -bal.netPaise },
        ],
        { payoutId: row!.id, description: 'Payout initiated' },
      );
      return row!;
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'payout.created',
      entityType: 'driver_payout',
      entityId: payout.id,
      metadata: { amountPaise: payout.amountPaise },
    });
    return payout;
  }

  /** Records the bank transfer outcome. Failure returns the money to the driver's balance. */
  async settlePayout(
    staffId: string,
    payoutId: string,
    outcome: { paid: true; reference: string } | { paid: false; reason: string },
  ) {
    const payout = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(driverPayouts)
        .where(eq(driverPayouts.id, payoutId))
        .for('update');
      if (!p) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout not found');
      if (p.status !== 'PENDING' && p.status !== 'PROCESSING') {
        throw new AppError(409, 'PAYOUT_ALREADY_SETTLED', 'This payout is already settled');
      }
      if (outcome.paid) {
        await this.ledger.post(
          tx,
          [
            { account: 'PAYOUT_CLEARING', amount: p.amountPaise },
            { account: 'GATEWAY_CLEARING', amount: -p.amountPaise },
          ],
          { payoutId, description: `Payout sent (${outcome.reference})` },
        );
      } else {
        await this.ledger.post(
          tx,
          [
            { account: 'PAYOUT_CLEARING', amount: p.amountPaise },
            { account: 'DRIVER_PAYABLE', amount: -p.amountPaise, ownerUserId: p.driverId },
          ],
          { payoutId, description: 'Payout failed; returned to balance' },
        );
      }
      const [updated] = await tx
        .update(driverPayouts)
        .set(
          outcome.paid
            ? { status: 'PAID', providerReference: outcome.reference, paidAt: new Date() }
            : { status: 'FAILED', failureReason: outcome.reason },
        )
        .where(eq(driverPayouts.id, payoutId))
        .returning();
      return updated!;
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: outcome.paid ? 'payout.paid' : 'payout.failed',
      entityType: 'driver_payout',
      entityId: payoutId,
    });
    return payout;
  }
}
