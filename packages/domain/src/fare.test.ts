import { describe, expect, it } from 'vitest';
import { calculateFare, PricingRule, settleFare } from './fare';
import { DomainError } from './errors';
import { divRound, formatInr, roundToRupee } from './money';

const rule: PricingRule = {
  baseFarePaise: 3000,
  includedDistanceMeters: 2000,
  perKmPaise: 1200,
  perMinutePaise: 150,
  minimumFarePaise: 4000,
  bookingFeePaise: 500,
  taxRateBps: 500,
  waitingFreeSeconds: 180,
  waitingPerMinutePaise: 100,
  commissionRateBps: 2000,
};

describe('money helpers', () => {
  it('rounds half up in integer arithmetic', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(0, 7)).toBe(0);
    expect(roundToRupee(13755)).toBe(13800);
    expect(roundToRupee(13749)).toBe(13700);
  });

  it('formats INR with Indian grouping', () => {
    expect(formatInr(12345678)).toBe('₹1,23,456.78');
    expect(formatInr(13800)).toBe('₹138');
  });
});

describe('calculateFare', () => {
  it('produces an itemised fare for a normal trip', () => {
    const fare = calculateFare({ rule, distanceMeters: 7500, durationSeconds: 1200 });
    expect(fare).toEqual({
      baseFarePaise: 3000,
      distanceChargePaise: 6600,
      timeChargePaise: 3000,
      waitingChargePaise: 0,
      surchargePaise: 0,
      minimumFareAdjustmentPaise: 0,
      rideFarePaise: 12600,
      discountPaise: 0,
      bookingFeePaise: 500,
      taxPaise: 655,
      roundingAdjustmentPaise: 45,
      totalPaise: 13800,
    });
  });

  it('applies the minimum fare to very short trips', () => {
    const fare = calculateFare({ rule, distanceMeters: 500, durationSeconds: 60 });
    expect(fare.minimumFareAdjustmentPaise).toBe(850);
    expect(fare.rideFarePaise).toBe(4000);
  });

  it('charges waiting time only beyond the free window', () => {
    const within = calculateFare({
      rule,
      distanceMeters: 0,
      durationSeconds: 0,
      waitingSeconds: 180,
    });
    const beyond = calculateFare({
      rule,
      distanceMeters: 0,
      durationSeconds: 0,
      waitingSeconds: 480,
    });
    expect(within.waitingChargePaise).toBe(0);
    expect(beyond.waitingChargePaise).toBe(500);
  });

  it('applies surge to the metered subtotal', () => {
    const fare = calculateFare({
      rule,
      distanceMeters: 7500,
      durationSeconds: 1200,
      surgeMultiplierBps: 15000,
    });
    expect(fare.surchargePaise).toBe(6300);
    expect(fare.rideFarePaise).toBe(18900);
  });

  it('caps a discount at the ride fare and never goes negative', () => {
    const fare = calculateFare({
      rule,
      distanceMeters: 7500,
      durationSeconds: 1200,
      discountPaise: 1_000_000,
    });
    expect(fare.discountPaise).toBe(12600);
    expect(fare.totalPaise).toBe(roundToRupee(500 + 25));
  });

  it.each([
    [{ distanceMeters: -1, durationSeconds: 0 }],
    [{ distanceMeters: 1.5, durationSeconds: 0 }],
    [{ distanceMeters: 0, durationSeconds: 0, surgeMultiplierBps: 9000 }],
    [{ distanceMeters: 0, durationSeconds: 0, discountPaise: -5 }],
  ])('rejects invalid input %j', (input) => {
    expect(() => calculateFare({ rule, ...input })).toThrow(DomainError);
  });

  it('rejects an invalid pricing rule', () => {
    expect(() =>
      calculateFare({ rule: { ...rule, perKmPaise: 12.5 }, distanceMeters: 1, durationSeconds: 1 }),
    ).toThrow(DomainError);
    expect(() =>
      calculateFare({ rule: { ...rule, taxRateBps: 9000 }, distanceMeters: 1, durationSeconds: 1 }),
    ).toThrow(DomainError);
  });
});

describe('settleFare', () => {
  it('splits a fare so every paisa is accounted for', () => {
    const fare = calculateFare({ rule, distanceMeters: 7500, durationSeconds: 1200 });
    const s = settleFare(fare, rule.commissionRateBps);
    expect(s).toEqual({
      commissionPaise: 2520,
      driverEarningPaise: 10080,
      platformNetPaise: 3065,
      taxPaise: 655,
    });
    expect(s.driverEarningPaise + s.platformNetPaise + s.taxPaise).toBe(fare.totalPaise);
  });

  it('pays the driver on the undiscounted fare (platform funds promos)', () => {
    const fare = calculateFare({
      rule,
      distanceMeters: 7500,
      durationSeconds: 1200,
      discountPaise: 5000,
    });
    const s = settleFare(fare, rule.commissionRateBps);
    expect(s.driverEarningPaise).toBe(10080);
    expect(s.driverEarningPaise + s.platformNetPaise + s.taxPaise).toBe(fare.totalPaise);
  });

  it('balances across many random trips', () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    };
    for (let i = 0; i < 1000; i++) {
      const fare = calculateFare({
        rule,
        distanceMeters: rand(60_000),
        durationSeconds: rand(7200),
        waitingSeconds: rand(900),
        surgeMultiplierBps: 10_000 + rand(10_000),
        discountPaise: rand(20_000),
      });
      const s = settleFare(fare, rand(10_001));
      expect(s.driverEarningPaise + s.platformNetPaise + s.taxPaise).toBe(fare.totalPaise);
      expect(s.driverEarningPaise).toBeGreaterThanOrEqual(0);
    }
  });
});
