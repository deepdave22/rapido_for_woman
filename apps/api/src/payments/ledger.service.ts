import { Injectable } from '@nestjs/common';
import { FareBreakdown, settleFare } from '@saheli/domain';
import { randomUUID } from 'node:crypto';
import { Tx } from '../database/database.module';
import { ledgerEntries } from '../database/schema';

type Account = (typeof ledgerEntries.$inferInsert)['account'];

/** Positive = debit, negative = credit. */
export interface Leg {
  account: Account;
  amount: number;
  ownerUserId?: string | null;
}

interface Refs {
  rideId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  payoutId?: string | null;
  description: string;
}

/**
 * Posts balanced transactions to the append-only ledger. Accounts follow the
 * platform's view: GATEWAY_CLEARING / CASH_HELD_BY_DRIVER are assets (money we
 * hold or are owed), DRIVER_PAYABLE / TAX_PAYABLE are liabilities,
 * PLATFORM_REVENUE is income and PROMO_EXPENSE is an expense.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, legs: Leg[], refs: Refs): Promise<string> {
    const nonZero = legs.filter((l) => l.amount !== 0);
    const sum = nonZero.reduce((s, l) => s + l.amount, 0);
    if (sum !== 0)
      throw new Error(`Unbalanced ledger transaction (${sum} paise): ${refs.description}`);
    if (nonZero.some((l) => !Number.isSafeInteger(l.amount))) {
      throw new Error('Ledger amounts must be integer paise');
    }
    const transactionId = randomUUID();
    if (!nonZero.length) return transactionId;
    await tx.insert(ledgerEntries).values(
      nonZero.map((l) => ({
        transactionId,
        account: l.account,
        direction: l.amount > 0 ? ('DEBIT' as const) : ('CREDIT' as const),
        amountPaise: Math.abs(l.amount),
        ownerUserId: l.ownerUserId ?? null,
        rideId: refs.rideId ?? null,
        paymentId: refs.paymentId ?? null,
        refundId: refs.refundId ?? null,
        payoutId: refs.payoutId ?? null,
        description: refs.description,
      })),
    );
    return transactionId;
  }

  /**
   * Ride fare received. `source` is where the money is: the gateway (online)
   * or the driver's pocket (cash, which the driver then owes the platform).
   */
  rideFareLegs(
    fare: FareBreakdown,
    commissionRateBps: number,
    driverId: string,
    source: 'GATEWAY_CLEARING' | 'CASH_HELD_BY_DRIVER',
  ): Leg[] {
    const s = settleFare(fare, commissionRateBps);
    return [
      {
        account: source,
        amount: fare.totalPaise,
        ownerUserId: source === 'CASH_HELD_BY_DRIVER' ? driverId : null,
      },
      { account: 'PROMO_EXPENSE', amount: fare.discountPaise },
      { account: 'DRIVER_PAYABLE', amount: -s.driverEarningPaise, ownerUserId: driverId },
      { account: 'TAX_PAYABLE', amount: -fare.taxPaise },
      {
        account: 'PLATFORM_REVENUE',
        amount: -(s.commissionPaise + fare.bookingFeePaise + fare.roundingAdjustmentPaise),
      },
    ];
  }

  /** Passenger cancellation fee: split with the driver at the commission rate. */
  cancellationFeeLegs(feePaise: number, commissionRateBps: number, driverId: string | null): Leg[] {
    if (!driverId) {
      return [
        { account: 'GATEWAY_CLEARING', amount: feePaise },
        { account: 'PLATFORM_REVENUE', amount: -feePaise },
      ];
    }
    const platform = Math.round((feePaise * commissionRateBps) / 10_000);
    return [
      { account: 'GATEWAY_CLEARING', amount: feePaise },
      { account: 'DRIVER_PAYABLE', amount: -(feePaise - platform), ownerUserId: driverId },
      { account: 'PLATFORM_REVENUE', amount: -platform },
    ];
  }

  /** Refunds are absorbed by the platform by default (operations may claw back separately). */
  refundLegs(amountPaise: number): Leg[] {
    return [
      { account: 'PLATFORM_REVENUE', amount: amountPaise },
      { account: 'GATEWAY_CLEARING', amount: -amountPaise },
    ];
  }
}
