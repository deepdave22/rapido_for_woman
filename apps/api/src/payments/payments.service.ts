import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { DB, Database, Tx } from '../database/database.module';
import { paymentWebhookEvents, payments, refunds, rides } from '../database/schema';
import { DispatchService } from '../dispatch/dispatch.service';
import { PricingService } from '../pricing/pricing.service';
import { LedgerService } from './ledger.service';
import { PAYMENT_PROVIDER, PaymentProvider, WebhookEvent } from './payment-provider';

type RideRow = typeof rides.$inferSelect;

/** What a ride currently owes: the final fare, or a cancellation fee. */
function amountDue(
  ride: RideRow,
): { amountPaise: number; kind: 'FARE' | 'CANCELLATION_FEE' } | null {
  if (ride.status === 'COMPLETED' && ride.finalTotalPaise) {
    return { amountPaise: ride.finalTotalPaise, kind: 'FARE' };
  }
  if (ride.status === 'CANCELLED' && ride.cancellationFeePaise > 0) {
    return { amountPaise: ride.cancellationFeePaise, kind: 'CANCELLATION_FEE' };
  }
  return null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly ledger: LedgerService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly dispatch: DispatchService,
  ) {}

  /**
   * Starts an online payment for what the ride owes. The amount comes from the
   * ride record, never from the client. Reuses a pending order if one exists.
   */
  async startOnlinePayment(passengerId: string, rideId: string) {
    const ride = await this.loadForPassenger(passengerId, rideId);
    const due = amountDue(ride);
    if (!due) throw new AppError(409, 'NOTHING_TO_PAY', 'There is nothing to pay for this ride');
    if (ride.paymentStatus === 'PAID')
      throw new AppError(409, 'ALREADY_PAID', 'This ride is already paid');
    if (due.kind === 'FARE' && ride.paymentMethod === 'CASH') {
      throw new AppError(409, 'CASH_RIDE', 'This ride is paid in cash to the driver');
    }

    const [pending] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.rideId, rideId),
          eq(payments.status, 'PENDING'),
          eq(payments.method, 'ONLINE'),
        ),
      );
    if (pending?.providerOrderId && pending.amountPaise === due.amountPaise) {
      return this.paymentView(pending);
    }

    const order = await this.provider.createOrder(due.amountPaise, `ride_${rideId.slice(0, 8)}`);
    const [payment] = await this.db
      .insert(payments)
      .values({
        rideId,
        payerUserId: passengerId,
        method: 'ONLINE',
        provider: this.provider.name,
        providerOrderId: order.orderId,
        amountPaise: due.amountPaise,
        status: 'PENDING',
      })
      .returning();
    await this.db.update(rides).set({ paymentStatus: 'PENDING' }).where(eq(rides.id, rideId));
    return this.paymentView(payment!);
  }

  private paymentView(p: typeof payments.$inferSelect) {
    return {
      paymentId: p.id,
      provider: p.provider,
      orderId: p.providerOrderId,
      amountPaise: p.amountPaise,
      currency: 'INR' as const,
      status: p.status,
      publicKey: this.provider.publicKey,
      sandbox: p.provider === 'sandbox',
    };
  }

  /**
   * Handles a gateway webhook. Verified against the raw body, recorded by
   * event id so retries are no-ops, and applied in one transaction.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ) {
    if (!rawBody) throw new AppError(400, 'RAW_BODY_MISSING', 'Webhook body missing');
    const event = this.provider.parseWebhook(rawBody, headers);

    const inserted = await this.db
      .insert(paymentWebhookEvents)
      .values({
        provider: this.provider.name,
        providerEventId: event.eventId,
        eventType: event.kind,
        payload: JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: paymentWebhookEvents.id });
    if (!inserted.length) return { status: 'duplicate' as const };

    try {
      const notify = await this.db.transaction((tx) => this.apply(tx, event));
      await this.db
        .update(paymentWebhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(paymentWebhookEvents.id, inserted[0]!.id));
      if (notify)
        this.dispatch.notifyRide({ ride: notify, previous: notify.status, withdrawnDrivers: [] });
      return { status: 'processed' as const };
    } catch (err) {
      // Forget the event so the gateway's retry is processed again; the error is logged and audited.
      this.logger.error({ err, eventId: event.eventId }, 'Webhook processing failed');
      await this.db
        .delete(paymentWebhookEvents)
        .where(eq(paymentWebhookEvents.id, inserted[0]!.id));
      throw err;
    }
  }

  private async apply(tx: Tx, event: WebhookEvent): Promise<RideRow | null> {
    if (event.kind === 'ignored') return null;
    if (event.kind === 'refund.processed') {
      await tx
        .update(refunds)
        .set({ status: 'SUCCEEDED' })
        .where(
          and(
            eq(refunds.providerRefundId, event.refundId),
            inArray(refunds.status, ['PROCESSING', 'APPROVED']),
          ),
        );
      return null;
    }

    const [payment] = await tx
      .select()
      .from(payments)
      .where(
        and(eq(payments.provider, this.provider.name), eq(payments.providerOrderId, event.orderId)),
      )
      .for('update');
    if (!payment) {
      this.logger.warn({ orderId: event.orderId }, 'Webhook for unknown order');
      return null;
    }

    if (event.kind === 'payment.failed') {
      if (payment.status === 'PAID') return null;
      await tx
        .update(payments)
        .set({ status: 'FAILED', failureReason: event.reason, providerPaymentId: event.paymentId })
        .where(eq(payments.id, payment.id));
      const [ride] = await tx
        .update(rides)
        .set({ paymentStatus: 'FAILED' })
        .where(and(eq(rides.id, payment.rideId), sql`${rides.paymentStatus} <> 'PAID'`))
        .returning();
      return ride ?? null;
    }

    // payment.captured
    if (payment.status === 'PAID') return null;
    if (event.amountPaise !== payment.amountPaise) {
      // Never mark paid on an amount mismatch; operations must reconcile by hand.
      await this.audit.record(
        {
          actorType: 'SYSTEM',
          action: 'payment.amount_mismatch',
          entityType: 'payment',
          entityId: payment.id,
          metadata: { expected: payment.amountPaise, received: event.amountPaise },
        },
        tx,
      );
      throw new AppError(
        422,
        'PAYMENT_AMOUNT_MISMATCH',
        'Captured amount does not match the order',
      );
    }
    await tx
      .update(payments)
      .set({ status: 'PAID', providerPaymentId: event.paymentId, paidAt: new Date() })
      .where(eq(payments.id, payment.id));
    const [ride] = await tx.select().from(rides).where(eq(rides.id, payment.rideId)).for('update');
    await this.postRideIncome(tx, ride!, payment.id, 'GATEWAY_CLEARING');
    const [updated] = await tx
      .update(rides)
      .set({ paymentStatus: 'PAID' })
      .where(eq(rides.id, ride!.id))
      .returning();
    return updated ?? null;
  }

  /** Driver confirms the passenger paid the fare in cash. */
  async confirmCashCollected(driverId: string, rideId: string) {
    const ride = await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(rides).where(eq(rides.id, rideId)).for('update');
      if (!r || r.driverId !== driverId)
        throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
      if (r.status !== 'COMPLETED')
        throw new AppError(409, 'RIDE_NOT_COMPLETED', 'Complete the ride first');
      if (r.paymentMethod !== 'CASH')
        throw new AppError(409, 'NOT_A_CASH_RIDE', 'This ride is paid online');
      if (r.paymentStatus === 'PAID') return r;
      const [payment] = await tx
        .insert(payments)
        .values({
          rideId,
          payerUserId: r.passengerId,
          method: 'CASH',
          provider: 'cash',
          amountPaise: r.finalTotalPaise!,
          status: 'PAID',
          paidAt: new Date(),
        })
        .returning({ id: payments.id });
      await this.postRideIncome(tx, r, payment!.id, 'CASH_HELD_BY_DRIVER');
      const [updated] = await tx
        .update(rides)
        .set({ paymentStatus: 'PAID' })
        .where(eq(rides.id, rideId))
        .returning();
      await this.audit.record(
        {
          actorType: 'USER',
          actorId: driverId,
          action: 'payment.cash_collected',
          entityType: 'ride',
          entityId: rideId,
        },
        tx,
      );
      return updated!;
    });
    this.dispatch.notifyRide({ ride, previous: ride.status, withdrawnDrivers: [] });
    return { rideId, paymentStatus: ride.paymentStatus };
  }

  private async postRideIncome(
    tx: Tx,
    ride: RideRow,
    paymentId: string,
    source: 'GATEWAY_CLEARING' | 'CASH_HELD_BY_DRIVER',
  ): Promise<void> {
    const rule = await this.pricing.ruleById(ride.pricingRuleId, tx);
    if (ride.status === 'COMPLETED') {
      await this.ledger.post(
        tx,
        this.ledger.rideFareLegs(
          ride.finalBreakdown!,
          rule.commissionRateBps,
          ride.driverId!,
          source,
        ),
        { rideId: ride.id, paymentId, description: 'Ride fare' },
      );
    } else {
      await this.ledger.post(
        tx,
        this.ledger.cancellationFeeLegs(
          ride.cancellationFeePaise,
          rule.commissionRateBps,
          ride.driverId,
        ),
        { rideId: ride.id, paymentId, description: 'Cancellation fee' },
      );
    }
  }

  async paymentsForRide(passengerId: string, rideId: string) {
    await this.loadForPassenger(passengerId, rideId);
    const rows = await this.db.select().from(payments).where(eq(payments.rideId, rideId));
    return rows.map((p) => ({
      id: p.id,
      method: p.method,
      amountPaise: p.amountPaise,
      status: p.status,
      failureReason: p.failureReason,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    }));
  }

  // ---------- refunds (four-eyes: requested and approved by different staff) ----------

  async requestRefund(staffId: string, paymentId: string, amountPaise: number, reason: string) {
    const [payment] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new AppError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only paid payments can be refunded');
    }
    if (payment.method !== 'ONLINE') {
      throw new AppError(
        409,
        'CASH_REFUND_UNSUPPORTED',
        'Cash refunds are handled outside the gateway',
      );
    }
    const [{ refunded }] = (
      await this.db.execute<{ refunded: number }>(
        sql`SELECT COALESCE(SUM(amount_paise), 0)::int AS refunded FROM refunds
           WHERE payment_id = ${paymentId} AND status NOT IN ('REJECTED', 'FAILED')`,
      )
    ).rows as [{ refunded: number }];
    if (refunded + amountPaise > payment.amountPaise) {
      throw new AppError(
        422,
        'REFUND_EXCEEDS_PAYMENT',
        'Refund is larger than the amount still refundable',
        {
          refundablePaise: payment.amountPaise - refunded,
        },
      );
    }
    const [refund] = await this.db
      .insert(refunds)
      .values({ paymentId, amountPaise, reason, requestedBy: staffId })
      .returning();
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'refund.requested',
      entityType: 'refund',
      entityId: refund!.id,
      metadata: { amountPaise },
    });
    return refund!;
  }

  async decideRefund(staffId: string, refundId: string, approve: boolean) {
    const result = await this.db.transaction(async (tx) => {
      const [refund] = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.id, refundId))
        .for('update');
      if (!refund) throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund not found');
      if (refund.status !== 'REQUESTED')
        throw new AppError(409, 'REFUND_ALREADY_DECIDED', 'Refund already decided');
      if (refund.requestedBy === staffId) {
        throw new AppError(
          403,
          'FOUR_EYES_REQUIRED',
          'A different staff member must approve this refund',
        );
      }
      if (!approve) {
        const [r] = await tx
          .update(refunds)
          .set({ status: 'REJECTED', approvedBy: staffId })
          .where(eq(refunds.id, refundId))
          .returning();
        return { refund: r!, payment: null };
      }
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, refund.paymentId))
        .for('update');
      const [r] = await tx
        .update(refunds)
        .set({ status: 'PROCESSING', approvedBy: staffId })
        .where(eq(refunds.id, refundId))
        .returning();
      return { refund: r!, payment: payment! };
    });

    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: approve ? 'refund.approved' : 'refund.rejected',
      entityType: 'refund',
      entityId: refundId,
    });
    if (!result.payment) return result.refund;

    // Call the gateway outside the transaction; record the outcome either way.
    try {
      const { refundId: providerRefundId } = await this.provider.refund(
        result.payment.providerPaymentId!,
        result.refund.amountPaise,
        `refund_${refundId.slice(0, 8)}`,
      );
      return await this.db.transaction(async (tx) => {
        const [r] = await tx
          .update(refunds)
          .set({ providerRefundId, status: 'PROCESSING' })
          .where(eq(refunds.id, refundId))
          .returning();
        await this.ledger.post(tx, this.ledger.refundLegs(result.refund.amountPaise), {
          rideId: result.payment!.rideId,
          paymentId: result.payment!.id,
          refundId,
          description: 'Refund to passenger',
        });
        const [{ refunded }] = (
          await tx.execute<{ refunded: number }>(
            sql`SELECT COALESCE(SUM(amount_paise), 0)::int AS refunded FROM refunds
               WHERE payment_id = ${result.payment!.id} AND status IN ('PROCESSING', 'SUCCEEDED')`,
          )
        ).rows as [{ refunded: number }];
        const status = refunded >= result.payment!.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        await tx.update(payments).set({ status }).where(eq(payments.id, result.payment!.id));
        await tx
          .update(rides)
          .set({ paymentStatus: status })
          .where(eq(rides.id, result.payment!.rideId));
        return r!;
      });
    } catch (err) {
      const [r] = await this.db
        .update(refunds)
        .set({
          status: 'FAILED',
          failureReason: err instanceof Error ? err.message : 'Gateway error',
        })
        .where(eq(refunds.id, refundId))
        .returning();
      return r!;
    }
  }

  private async loadForPassenger(passengerId: string, rideId: string): Promise<RideRow> {
    const [ride] = await this.db.select().from(rides).where(eq(rides.id, rideId));
    if (!ride || ride.passengerId !== passengerId)
      throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    return ride;
  }
}
