import { describe, expect, it } from 'vitest';
import { CancellationPolicy, decideCancellationFee } from './cancellation';
import { formatIndianMobile, maskIndianMobile, normalizeIndianMobile } from './phone';
import { DomainError } from './errors';

const policy: CancellationPolicy = {
  passengerFeePaise: 2500,
  freeWindowSeconds: 120,
  arrivedGraceSeconds: 180,
};
const t0 = new Date('2026-10-30T10:00:00Z');
const after = (s: number) => new Date(t0.getTime() + s * 1000);

describe('decideCancellationFee', () => {
  it('is free before a driver is assigned', () => {
    expect(
      decideCancellationFee({ policy, actor: 'PASSENGER', status: 'SEARCHING', now: after(999) }),
    ).toEqual({ feePaise: 0, reason: 'NO_DRIVER_YET' });
  });

  it('is free within the window after assignment, charged after it', () => {
    const base = { policy, actor: 'PASSENGER' as const, status: 'DRIVER_ARRIVING' as const };
    expect(decideCancellationFee({ ...base, driverAssignedAt: t0, now: after(120) }).feePaise).toBe(
      0,
    );
    expect(decideCancellationFee({ ...base, driverAssignedAt: t0, now: after(121) })).toEqual({
      feePaise: 2500,
      reason: 'AFTER_FREE_WINDOW',
    });
  });

  it('charges when the driver has waited past the grace period', () => {
    const base = {
      policy,
      actor: 'PASSENGER' as const,
      status: 'DRIVER_ARRIVED' as const,
      driverAssignedAt: t0,
      driverArrivedAt: after(600),
    };
    expect(decideCancellationFee({ ...base, now: after(700) }).feePaise).toBe(0);
    expect(decideCancellationFee({ ...base, now: after(781) }).reason).toBe('DRIVER_WAITED');
  });

  it('never charges the passenger when someone else cancels', () => {
    for (const actor of ['DRIVER', 'SYSTEM', 'ADMIN'] as const) {
      expect(
        decideCancellationFee({
          policy,
          actor,
          status: 'DRIVER_ARRIVED',
          driverAssignedAt: t0,
          driverArrivedAt: t0,
          now: after(9999),
        }).feePaise,
      ).toBe(0);
    }
  });
});

describe('Indian mobile numbers', () => {
  it.each(['9876543210', '98765 43210', '098765-43210', '+91 98765 43210', '919876543210'])(
    'normalises %s',
    (input) => expect(normalizeIndianMobile(input)).toBe('+919876543210'),
  );

  it.each(['12345', '5876543210', '+1 4155550123', '98765432101', 'abcdefghij'])(
    'rejects %s',
    (input) => expect(() => normalizeIndianMobile(input)).toThrow(DomainError),
  );

  it('formats and masks', () => {
    expect(formatIndianMobile('+919876543210')).toBe('+91 98765 43210');
    expect(maskIndianMobile('+919876543210')).toBe('+91 ••••• •3210');
  });
});
