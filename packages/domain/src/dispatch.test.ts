import { describe, expect, it } from 'vitest';
import { assertLatLng, haversineMeters, rankCandidates, searchRadiusForRound } from './dispatch';
import { DomainError } from './errors';

describe('haversineMeters', () => {
  it('measures a known distance (MG Road to Koramangala, Bengaluru ≈ 4.9 km)', () => {
    const d = haversineMeters({ lat: 12.9756, lng: 77.6066 }, { lat: 12.9352, lng: 77.6245 });
    expect(d).toBeGreaterThan(4800);
    expect(d).toBeLessThan(4900);
  });

  it('is zero for the same point', () => {
    expect(haversineMeters({ lat: 19.07, lng: 72.87 }, { lat: 19.07, lng: 72.87 })).toBe(0);
  });
});

describe('assertLatLng', () => {
  it.each([
    { lat: 91, lng: 0 },
    { lat: 0, lng: 181 },
    { lat: Number.NaN, lng: 0 },
  ])('rejects %j', (p) => expect(() => assertLatLng(p, 'pickup')).toThrow(DomainError));
});

describe('rankCandidates', () => {
  it('prefers the nearest driver', () => {
    const ranked = rankCandidates([
      { driverId: 'far', pickupDistanceMeters: 2000, idleSeconds: 0 },
      { driverId: 'near', pickupDistanceMeters: 300, idleSeconds: 0 },
    ]);
    expect(ranked.map((c) => c.driverId)).toEqual(['near', 'far']);
  });

  it('lets a long-waiting driver win a near-tie', () => {
    const ranked = rankCandidates([
      { driverId: 'just-freed', pickupDistanceMeters: 400, idleSeconds: 0 },
      { driverId: 'waiting', pickupDistanceMeters: 600, idleSeconds: 20 * 60 },
    ]);
    expect(ranked[0]!.driverId).toBe('waiting');
  });

  it('caps the idle bonus so distance still dominates', () => {
    const ranked = rankCandidates([
      { driverId: 'near', pickupDistanceMeters: 500, idleSeconds: 0 },
      { driverId: 'idle-for-hours', pickupDistanceMeters: 3000, idleSeconds: 5 * 3600 },
    ]);
    expect(ranked[0]!.driverId).toBe('near');
  });

  it('is deterministic for equal scores', () => {
    const c = [
      { driverId: 'b', pickupDistanceMeters: 100, idleSeconds: 0 },
      { driverId: 'a', pickupDistanceMeters: 100, idleSeconds: 0 },
    ];
    expect(rankCandidates(c).map((x) => x.driverId)).toEqual(['a', 'b']);
  });
});

describe('searchRadiusForRound', () => {
  it('expands per round and stops after the last', () => {
    const radii = [2000, 4000, 6000];
    expect(searchRadiusForRound(1, radii)).toBe(2000);
    expect(searchRadiusForRound(3, radii)).toBe(6000);
    expect(searchRadiusForRound(4, radii)).toBeNull();
    expect(() => searchRadiusForRound(0, radii)).toThrow(DomainError);
  });
});
