import { Inject, Injectable } from '@nestjs/common';
import { applyBps } from '@saheli/domain';
import { and, count, eq, gt, lte, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { DB, Database, Tx } from '../database/database.module';
import { promotionRedemptions, promotions } from '../database/schema';

export type Promotion = typeof promotions.$inferSelect;

@Injectable()
export class PromotionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** A promotion the user can still use now, or a clear reason why not. */
  async findRedeemable(code: string, userId: string, tx?: Tx): Promise<Promotion> {
    const q = tx ?? this.db;
    const now = new Date();
    const [promo] = await q
      .select()
      .from(promotions)
      .where(
        and(
          sql`upper(${promotions.code}) = upper(${code})`,
          eq(promotions.active, true),
          lte(promotions.startsAt, now),
          gt(promotions.endsAt, now),
        ),
      );
    if (!promo) throw new AppError(422, 'PROMO_INVALID', 'This promo code is not valid');

    if (promo.totalRedemptionLimit !== null) {
      const [total] = await q
        .select({ n: count() })
        .from(promotionRedemptions)
        .where(eq(promotionRedemptions.promotionId, promo.id));
      if ((total?.n ?? 0) >= promo.totalRedemptionLimit) {
        throw new AppError(422, 'PROMO_EXHAUSTED', 'This promo code has been fully used');
      }
    }
    const [mine] = await q
      .select({ n: count() })
      .from(promotionRedemptions)
      .where(
        and(
          eq(promotionRedemptions.promotionId, promo.id),
          eq(promotionRedemptions.userId, userId),
        ),
      );
    if ((mine?.n ?? 0) >= promo.perUserLimit) {
      throw new AppError(422, 'PROMO_ALREADY_USED', 'You have already used this promo code');
    }
    return promo;
  }

  /** Discount on a ride fare in paise; 0 when the minimum fare is not met. */
  discountFor(promo: Promotion, rideFarePaise: number): number {
    if (rideFarePaise < promo.minRideFarePaise) return 0;
    const raw =
      promo.discountType === 'PERCENT'
        ? applyBps(rideFarePaise, promo.discountValue)
        : promo.discountValue;
    const capped = promo.maxDiscountPaise !== null ? Math.min(raw, promo.maxDiscountPaise) : raw;
    return Math.min(capped, rideFarePaise);
  }

  /**
   * Records a redemption inside the booking transaction. Limits are re-checked
   * under a per-promotion lock so concurrent bookings cannot exceed them.
   */
  async redeem(
    tx: Tx,
    args: {
      promotionId: string;
      code: string;
      userId: string;
      rideId: string;
      discountPaise: number;
    },
  ): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'promo:' + args.promotionId}))`);
    await this.findRedeemable(args.code, args.userId, tx);
    await tx.insert(promotionRedemptions).values({
      promotionId: args.promotionId,
      rideId: args.rideId,
      userId: args.userId,
      discountPaise: args.discountPaise,
    });
  }
}
