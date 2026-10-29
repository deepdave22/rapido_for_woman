import { DomainError } from './errors';
import { applyBps, assertPaise, BPS_DENOMINATOR, divRound, Paise, roundToRupee } from './money';

/**
 * One versioned pricing rule for a (service zone, vehicle category). Stored in
 * `pricing_rules`; a quote records the rule version it was priced with so a fare
 * never changes after it has been shown to the passenger.
 */
export interface PricingRule {
  baseFarePaise: Paise;
  /** Distance covered by the base fare before per-km charges start. */
  includedDistanceMeters: number;
  perKmPaise: Paise;
  perMinutePaise: Paise;
  minimumFarePaise: Paise;
  /** Platform fee charged to the passenger on top of the ride fare. */
  bookingFeePaise: Paise;
  /** Tax on (ride fare - discount + booking fee), in basis points. 500 = 5%. */
  taxRateBps: number;
  waitingFreeSeconds: number;
  waitingPerMinutePaise: Paise;
  /** Platform commission on the ride fare, in basis points. */
  commissionRateBps: number;
}

export interface FareInput {
  rule: PricingRule;
  distanceMeters: number;
  durationSeconds: number;
  waitingSeconds?: number;
  /** 10000 = no surge. Capped by the caller's configured maximum. */
  surgeMultiplierBps?: number;
  discountPaise?: Paise;
}

export interface FareBreakdown {
  baseFarePaise: Paise;
  distanceChargePaise: Paise;
  timeChargePaise: Paise;
  waitingChargePaise: Paise;
  surchargePaise: Paise;
  minimumFareAdjustmentPaise: Paise;
  /** Fare for the ride itself, before discount, fee and tax. Driver earnings derive from this. */
  rideFarePaise: Paise;
  discountPaise: Paise;
  bookingFeePaise: Paise;
  taxPaise: Paise;
  roundingAdjustmentPaise: Paise;
  /** What the passenger pays. */
  totalPaise: Paise;
}

function assertNonNegativeInt(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError('INVALID_ARGUMENT', `${field} must be a non-negative integer`);
  }
}

export function validatePricingRule(rule: PricingRule): void {
  assertPaise(rule.baseFarePaise, 'baseFarePaise');
  assertPaise(rule.perKmPaise, 'perKmPaise');
  assertPaise(rule.perMinutePaise, 'perMinutePaise');
  assertPaise(rule.minimumFarePaise, 'minimumFarePaise');
  assertPaise(rule.bookingFeePaise, 'bookingFeePaise');
  assertPaise(rule.waitingPerMinutePaise, 'waitingPerMinutePaise');
  assertNonNegativeInt(rule.includedDistanceMeters, 'includedDistanceMeters');
  assertNonNegativeInt(rule.waitingFreeSeconds, 'waitingFreeSeconds');
  if (!Number.isInteger(rule.taxRateBps) || rule.taxRateBps < 0 || rule.taxRateBps > 5000) {
    throw new DomainError('INVALID_ARGUMENT', 'taxRateBps must be between 0 and 5000');
  }
  if (
    !Number.isInteger(rule.commissionRateBps) ||
    rule.commissionRateBps < 0 ||
    rule.commissionRateBps > BPS_DENOMINATOR
  ) {
    throw new DomainError('INVALID_ARGUMENT', 'commissionRateBps must be between 0 and 10000');
  }
}

/**
 * Calculates a fare. Runs only on the server; clients display the result and
 * never send a fare back to be trusted.
 */
export function calculateFare(input: FareInput): FareBreakdown {
  const { rule } = input;
  validatePricingRule(rule);
  assertNonNegativeInt(input.distanceMeters, 'distanceMeters');
  assertNonNegativeInt(input.durationSeconds, 'durationSeconds');
  const waitingSeconds = input.waitingSeconds ?? 0;
  assertNonNegativeInt(waitingSeconds, 'waitingSeconds');
  const surgeBps = input.surgeMultiplierBps ?? BPS_DENOMINATOR;
  if (!Number.isInteger(surgeBps) || surgeBps < BPS_DENOMINATOR) {
    throw new DomainError('INVALID_ARGUMENT', 'surgeMultiplierBps must be an integer >= 10000');
  }
  const requestedDiscount = input.discountPaise ?? 0;
  assertPaise(requestedDiscount, 'discountPaise');

  const chargeableMeters = Math.max(0, input.distanceMeters - rule.includedDistanceMeters);
  const distanceChargePaise = divRound(chargeableMeters * rule.perKmPaise, 1000);
  const timeChargePaise = divRound(input.durationSeconds * rule.perMinutePaise, 60);
  const chargeableWaiting = Math.max(0, waitingSeconds - rule.waitingFreeSeconds);
  const waitingChargePaise = divRound(chargeableWaiting * rule.waitingPerMinutePaise, 60);

  const subtotal = rule.baseFarePaise + distanceChargePaise + timeChargePaise + waitingChargePaise;
  const surchargePaise = applyBps(subtotal, surgeBps - BPS_DENOMINATOR);
  const beforeMinimum = subtotal + surchargePaise;
  const minimumFareAdjustmentPaise = Math.max(0, rule.minimumFarePaise - beforeMinimum);
  const rideFarePaise = beforeMinimum + minimumFareAdjustmentPaise;

  const discountPaise = Math.min(requestedDiscount, rideFarePaise);
  const taxable = rideFarePaise - discountPaise + rule.bookingFeePaise;
  const taxPaise = applyBps(taxable, rule.taxRateBps);
  const unrounded = taxable + taxPaise;
  const totalPaise = roundToRupee(unrounded);

  return {
    baseFarePaise: rule.baseFarePaise,
    distanceChargePaise,
    timeChargePaise,
    waitingChargePaise,
    surchargePaise,
    minimumFareAdjustmentPaise,
    rideFarePaise,
    discountPaise,
    bookingFeePaise: rule.bookingFeePaise,
    taxPaise,
    roundingAdjustmentPaise: totalPaise - unrounded,
    totalPaise,
  };
}

export interface Settlement {
  /** Platform commission taken from the ride fare. */
  commissionPaise: Paise;
  /** What the driver earns for the trip. */
  driverEarningPaise: Paise;
  /**
   * Platform revenue: commission + booking fee - discount (discounts are
   * platform-funded) + rounding. Tax is collected and remitted, not revenue.
   * Can be negative on heavily discounted rides.
   */
  platformNetPaise: Paise;
  taxPaise: Paise;
}

/**
 * Splits a completed fare between driver and platform. Promotional discounts
 * are funded by the platform, so the driver earns on the undiscounted ride fare.
 */
export function settleFare(fare: FareBreakdown, commissionRateBps: number): Settlement {
  if (
    !Number.isInteger(commissionRateBps) ||
    commissionRateBps < 0 ||
    commissionRateBps > BPS_DENOMINATOR
  ) {
    throw new DomainError('INVALID_ARGUMENT', 'commissionRateBps must be between 0 and 10000');
  }
  const commissionPaise = applyBps(fare.rideFarePaise, commissionRateBps);
  const driverEarningPaise = fare.rideFarePaise - commissionPaise;
  const platformNetPaise =
    commissionPaise + fare.bookingFeePaise - fare.discountPaise + fare.roundingAdjustmentPaise;
  return { commissionPaise, driverEarningPaise, platformNetPaise, taxPaise: fare.taxPaise };
}
