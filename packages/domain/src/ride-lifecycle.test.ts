import { describe, expect, it } from 'vitest';
import {
  allowedNextStatuses,
  assertRideTransition,
  isTerminal,
  RIDE_ACTORS,
  RIDE_STATUSES,
  RideStatus,
} from './ride-lifecycle';
import { DomainError } from './errors';

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof DomainError ? e.code : 'NOT_A_DOMAIN_ERROR';
  }
}

describe('ride lifecycle', () => {
  it('allows the happy path in order', () => {
    const path: [RideStatus, RideStatus, (typeof RIDE_ACTORS)[number]][] = [
      ['REQUESTED', 'SEARCHING', 'SYSTEM'],
      ['SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER'],
      ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER'],
      ['DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'DRIVER'],
      ['DRIVER_ARRIVED', 'IN_PROGRESS', 'DRIVER'],
      ['IN_PROGRESS', 'COMPLETED', 'DRIVER'],
    ];
    for (const [from, to, actor] of path) {
      expect(() =>
        assertRideTransition(from, to, actor, { pickupPinVerified: true }),
      ).not.toThrow();
    }
  });

  it('refuses to start a trip before the pickup PIN is verified', () => {
    expect(codeOf(() => assertRideTransition('DRIVER_ARRIVED', 'IN_PROGRESS', 'DRIVER'))).toBe(
      'PICKUP_NOT_VERIFIED',
    );
  });

  it('never leaves a terminal status', () => {
    for (const from of RIDE_STATUSES.filter(isTerminal)) {
      for (const to of RIDE_STATUSES) {
        for (const actor of RIDE_ACTORS) {
          expect(codeOf(() => assertRideTransition(from, to, actor))).toBeDefined();
        }
      }
    }
  });

  it('cannot complete a ride twice', () => {
    expect(codeOf(() => assertRideTransition('COMPLETED', 'COMPLETED', 'DRIVER'))).toBe(
      'RIDE_ALREADY_IN_STATUS',
    );
  });

  it('does not let a passenger drive the lifecycle', () => {
    expect(codeOf(() => assertRideTransition('SEARCHING', 'DRIVER_ASSIGNED', 'PASSENGER'))).toBe(
      'TRANSITION_NOT_PERMITTED',
    );
    expect(codeOf(() => assertRideTransition('IN_PROGRESS', 'COMPLETED', 'PASSENGER'))).toBe(
      'TRANSITION_NOT_PERMITTED',
    );
  });

  it('only lets an admin end a trip that is in progress', () => {
    expect(allowedNextStatuses('IN_PROGRESS', 'PASSENGER')).toEqual([]);
    expect(allowedNextStatuses('IN_PROGRESS', 'ADMIN')).toEqual(['COMPLETED', 'CANCELLED']);
  });

  it('sends a ride back to searching when the driver cancels before pickup', () => {
    for (const from of ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'] as const) {
      expect(allowedNextStatuses(from, 'DRIVER')).toContain('SEARCHING');
      expect(allowedNextStatuses(from, 'DRIVER')).not.toContain('CANCELLED');
    }
  });

  it('rejects skipping states', () => {
    expect(codeOf(() => assertRideTransition('SEARCHING', 'IN_PROGRESS', 'DRIVER'))).toBe(
      'INVALID_RIDE_TRANSITION',
    );
  });
});
