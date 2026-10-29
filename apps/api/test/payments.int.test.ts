import { settleFare } from '@saheli/domain';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { payments, rides, staffUsers } from '../src/database/schema';
import { EarningsService } from '../src/payments/earnings.service';
import { PaymentsService } from '../src/payments/payments.service';
import {
  approvedDriver,
  bearer,
  bookRide,
  completeRide,
  createTestApp,
  currentOffer,
  idemKey,
  readyPassenger,
  resetDatabase,
  seed,
  sendWebhook,
  TestContext,
} from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  await seed(ctx);
});

async function ledgerTotals() {
  const { rows } = await ctx.db.execute<{ account: string; net: number }>(sql`
    SELECT account, SUM(CASE direction WHEN 'DEBIT' THEN amount_paise ELSE -amount_paise END)::int AS net
      FROM financial_ledger_entries GROUP BY account`);
  return Object.fromEntries(rows.map((r) => [r.account, Number(r.net)]));
}

async function startPayment(token: string, rideId: string) {
  return ctx.http
    .post(`/v1/rides/${rideId}/payments`)
    .set(bearer(token))
    .set('Idempotency-Key', idemKey())
    .expect(201);
}

describe('online payments', () => {
  it('marks a ride paid only on a verified webhook, once, with a balanced ledger', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d, 'ONLINE');
    const [ride] = await ctx.db.select().from(rides).where(eq(rides.id, rideId));

    const started = await startPayment(p.accessToken, rideId);
    expect(started.body).toMatchObject({
      amountPaise: ride!.finalTotalPaise,
      sandbox: true,
      status: 'PENDING',
    });
    const entity = {
      id: 'pay_1',
      order_id: started.body.orderId,
      amount: started.body.amountPaise,
    };

    const forged = await sendWebhook(ctx, 'payment.captured', entity, {
      secret: 'wrong-secret-0000000',
    }).expect(401);
    expect(forged.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await ctx.db.select().from(rides).where(eq(rides.id, rideId)))[0]!.paymentStatus).toBe(
      'PENDING',
    );

    await sendWebhook(ctx, 'payment.captured', entity, { eventId: 'evt_A' }).expect(200);
    const dup = await sendWebhook(ctx, 'payment.captured', entity, { eventId: 'evt_A' }).expect(
      200,
    );
    expect(dup.body.status).toBe('duplicate');

    const paid = await ctx.http.get(`/v1/rides/${rideId}`).set(bearer(p.accessToken));
    expect(paid.body.paymentStatus).toBe('PAID');

    const s = settleFare(ride!.finalBreakdown!, 1500);
    const totals = await ledgerTotals();
    expect(totals).toMatchObject({
      GATEWAY_CLEARING: ride!.finalTotalPaise,
      DRIVER_PAYABLE: -s.driverEarningPaise,
      TAX_PAYABLE: -s.taxPaise,
    });
    expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBe(0);

    await ctx.http
      .post(`/v1/rides/${rideId}/payments`)
      .set(bearer(p.accessToken))
      .set('Idempotency-Key', idemKey())
      .expect(409);
  });

  it('refuses to mark paid when the captured amount differs', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d, 'ONLINE');
    const started = await startPayment(p.accessToken, rideId);
    const res = await sendWebhook(ctx, 'payment.captured', {
      id: 'pay_x',
      order_id: started.body.orderId,
      amount: started.body.amountPaise - 100,
    }).expect(422);
    expect(res.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    const [pay] = await ctx.db.select().from(payments).where(eq(payments.rideId, rideId));
    expect(pay!.status).toBe('PENDING');
    expect(await ledgerTotals()).toEqual({});
  });

  it('records a failure and accepts a later successful retry', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d, 'ONLINE');
    const started = await startPayment(p.accessToken, rideId);
    const entity = {
      id: 'pay_f',
      order_id: started.body.orderId,
      amount: started.body.amountPaise,
    };
    await sendWebhook(ctx, 'payment.failed', {
      ...entity,
      error_description: 'UPI timeout',
    }).expect(200);
    expect(
      (await ctx.http.get(`/v1/rides/${rideId}`).set(bearer(p.accessToken))).body.paymentStatus,
    ).toBe('FAILED');
    await sendWebhook(ctx, 'payment.captured', { ...entity, id: 'pay_ok' }).expect(200);
    expect(
      (await ctx.http.get(`/v1/rides/${rideId}`).set(bearer(p.accessToken))).body.paymentStatus,
    ).toBe('PAID');
  });

  it('collects a cancellation fee online', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const ride = await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d);
    await ctx.http
      .post(`/v1/driver/offers/${offer!.id}/accept`)
      .set(bearer(d.accessToken))
      .expect(200);
    await ctx.db
      .update(rides)
      .set({ driverAssignedAt: new Date(Date.now() - 600_000) })
      .where(eq(rides.id, ride.id));
    await ctx.http
      .post(`/v1/rides/${ride.id}/cancel`)
      .set(bearer(p.accessToken))
      .send({ reason: 'Late' })
      .expect(200);

    const started = await startPayment(p.accessToken, ride.id);
    expect(started.body.amountPaise).toBe(1000);
    await sendWebhook(ctx, 'payment.captured', {
      id: 'pay_c',
      order_id: started.body.orderId,
      amount: 1000,
    }).expect(200);
    const totals = await ledgerTotals();
    expect(totals.GATEWAY_CLEARING).toBe(1000);
    expect(totals.DRIVER_PAYABLE).toBe(-850);
  });

  it("does not let one passenger pay or see another's ride", async () => {
    const a = await readyPassenger(ctx, 1);
    const b = await readyPassenger(ctx, 3);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, a, d, 'ONLINE');
    await ctx.http
      .post(`/v1/rides/${rideId}/payments`)
      .set(bearer(b.accessToken))
      .set('Idempotency-Key', idemKey())
      .expect(404);
    await ctx.http.get(`/v1/rides/${rideId}/payments`).set(bearer(b.accessToken)).expect(404);
  });
});

describe('cash and driver earnings', () => {
  it('records cash collection and shows what the driver owes', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d, 'CASH');
    const [ride] = await ctx.db.select().from(rides).where(eq(rides.id, rideId));

    const online = await ctx.http
      .post(`/v1/rides/${rideId}/payments`)
      .set(bearer(p.accessToken))
      .set('Idempotency-Key', idemKey())
      .expect(409);
    expect(online.body.error.code).toBe('CASH_RIDE');

    await ctx.http
      .post(`/v1/driver/rides/${rideId}/cash-collected`)
      .set(bearer(d.accessToken))
      .expect(200);
    await ctx.http
      .post(`/v1/driver/rides/${rideId}/cash-collected`)
      .set(bearer(d.accessToken))
      .expect(200);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const res = await ctx.http
      .get(`/v1/driver/earnings?from=${today}&to=${today}`)
      .set(bearer(d.accessToken))
      .expect(200);
    const s = settleFare(ride!.finalBreakdown!, 1500);
    expect(res.body).toMatchObject({
      trips: 1,
      earningsPaise: s.driverEarningPaise,
      cashCollectedPaise: ride!.finalTotalPaise,
      commissionPaise: s.commissionPaise,
      balance: {
        payablePaise: s.driverEarningPaise,
        cashHeldPaise: ride!.finalTotalPaise,
        netPaise: s.driverEarningPaise - ride!.finalTotalPaise!,
      },
    });

    const csv = await ctx.http
      .get(`/v1/driver/earnings/statement.csv?from=${today}&to=${today}`)
      .set(bearer(d.accessToken))
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[1]).toContain(rideId);
  });

  it('pays out what is owed, and restores the balance if the transfer fails', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d, 'ONLINE');
    const started = await startPayment(p.accessToken, rideId);
    await sendWebhook(ctx, 'payment.captured', {
      id: 'pay_po',
      order_id: started.body.orderId,
      amount: started.body.amountPaise,
    }).expect(200);

    const earnings = ctx.app.get(EarningsService);
    const staff = randomUUID();
    const before = await earnings.balance(d.userId);
    expect(before.netPaise).toBeGreaterThan(0);

    const payout = await earnings.createPayout(staff, d.userId, '2026-10-01', '2026-10-31');
    expect(payout.amountPaise).toBe(before.netPaise);
    expect((await earnings.balance(d.userId)).netPaise).toBe(0);
    await expect(
      earnings.createPayout(staff, d.userId, '2026-10-01', '2026-10-31'),
    ).rejects.toMatchObject({
      code: 'PAYOUT_IN_PROGRESS',
    });

    await earnings.settlePayout(staff, payout.id, { paid: false, reason: 'Invalid IFSC' });
    expect((await earnings.balance(d.userId)).netPaise).toBe(before.netPaise);

    const retry = await earnings.createPayout(staff, d.userId, '2026-10-01', '2026-10-31');
    await earnings.settlePayout(staff, retry.id, { paid: true, reference: 'UTR123' });
    expect((await earnings.balance(d.userId)).netPaise).toBe(0);
    const totals = await ledgerTotals();
    expect(totals.PAYOUT_CLEARING ?? 0).toBe(0);
  });
});

describe('refunds', () => {
  async function staff(n: number) {
    const [s] = await ctx.db
      .insert(staffUsers)
      .values({ email: `staff${n}@test.invalid`, fullName: `Staff ${n}`, passwordHash: 'x' })
      .returning({ id: staffUsers.id });
    return s!.id;
  }

  it('needs a second staff member to approve, and cannot exceed the payment', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d, 'ONLINE');
    const started = await startPayment(p.accessToken, rideId);
    await sendWebhook(ctx, 'payment.captured', {
      id: 'pay_r',
      order_id: started.body.orderId,
      amount: started.body.amountPaise,
    }).expect(200);

    const payments = ctx.app.get(PaymentsService);
    const s1 = await staff(1);
    const s2 = await staff(2);
    const paymentId = started.body.paymentId as string;
    const amount = started.body.amountPaise as number;

    await expect(
      payments.requestRefund(s1, paymentId, amount + 1, 'too much'),
    ).rejects.toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
    });
    const refund = await payments.requestRefund(s1, paymentId, 500, 'Driver took a longer route');
    await expect(payments.decideRefund(s1, refund.id, true)).rejects.toMatchObject({
      code: 'FOUR_EYES_REQUIRED',
    });
    const done = await payments.decideRefund(s2, refund.id, true);
    expect(done.status).toBe('PROCESSING');
    expect(done.providerRefundId).toMatch(/^sandbox_refund_/);

    const ride = await ctx.http.get(`/v1/rides/${rideId}`).set(bearer(p.accessToken));
    expect(ride.body.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect((await ledgerTotals()).GATEWAY_CLEARING).toBe(amount - 500);
  });
});
