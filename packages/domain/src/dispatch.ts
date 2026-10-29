import { DomainError } from './errors';

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

export function assertLatLng(p: LatLng, field: string): void {
  if (
    !Number.isFinite(p.lat) ||
    !Number.isFinite(p.lng) ||
    Math.abs(p.lat) > 90 ||
    Math.abs(p.lng) > 180
  ) {
    throw new DomainError('INVALID_COORDINATES', `${field} is not a valid coordinate`);
  }
}

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

export interface DispatchCandidate {
  driverId: string;
  pickupDistanceMeters: number;
  /** Seconds since the driver last became free. Longer-waiting drivers get a fairness bonus. */
  idleSeconds: number;
}

export interface RankingWeights {
  /** Score points lost per 100 m from pickup. */
  distancePer100m: number;
  /** Score points gained per idle minute, capped at `maxIdleBonus`. */
  idlePerMinute: number;
  maxIdleBonus: number;
}

export const DEFAULT_RANKING: RankingWeights = {
  distancePer100m: 10,
  idlePerMinute: 2,
  maxIdleBonus: 60,
};

export interface RankedCandidate extends DispatchCandidate {
  score: number;
}

/**
 * Orders candidates best-first. Distance dominates (pickup time matters most to
 * the passenger), and idle time breaks near-ties so the same nearby driver does
 * not get every request. Ties fall back to driver id for determinism.
 */
export function rankCandidates(
  candidates: readonly DispatchCandidate[],
  weights: RankingWeights = DEFAULT_RANKING,
): RankedCandidate[] {
  return candidates
    .map((c) => {
      const distancePenalty = (c.pickupDistanceMeters / 100) * weights.distancePer100m;
      const idleBonus = Math.min(
        weights.maxIdleBonus,
        (Math.max(0, c.idleSeconds) / 60) * weights.idlePerMinute,
      );
      return { ...c, score: Math.round(1000 - distancePenalty + idleBonus) };
    })
    .sort((a, b) => b.score - a.score || a.driverId.localeCompare(b.driverId));
}

/** Search radius for each dispatch round; null means stop searching. */
export function searchRadiusForRound(round: number, radiiMeters: readonly number[]): number | null {
  if (!Number.isInteger(round) || round < 1) {
    throw new DomainError('INVALID_ARGUMENT', 'round must be a positive integer');
  }
  return radiiMeters[round - 1] ?? null;
}
