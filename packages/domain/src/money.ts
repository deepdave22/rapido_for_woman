import { DomainError } from './errors';

/**
 * All money is held as integer paise (1 INR = 100 paise). Floating point never
 * touches a monetary amount.
 */
export type Paise = number;

export const BPS_DENOMINATOR = 10_000;

export function assertPaise(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError(
      'INVALID_AMOUNT',
      `${field} must be a non-negative integer number of paise`,
    );
  }
}

/** Integer division rounded half away from zero, for non-negative operands. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new DomainError('INVALID_ARGUMENT', 'denominator must be positive');
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** value * bps / 10000, rounded half up. */
export function applyBps(value: Paise, bps: number): Paise {
  return divRound(value * bps, BPS_DENOMINATOR);
}

/** Round to the nearest whole rupee (half up). */
export function roundToRupee(value: Paise): Paise {
  return divRound(value, 100) * 100;
}

/** "₹1,234.50" using Indian digit grouping. */
export function formatInr(value: Paise): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = new Intl.NumberFormat('en-IN').format(rupees);
  return `${sign}₹${grouped}${paise ? `.${String(paise).padStart(2, '0')}` : ''}`;
}
