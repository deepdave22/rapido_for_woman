import { assertPaise, Paise } from './money';
import { RideActor, RideStatus } from './ride-lifecycle';

export interface CancellationPolicy {
  /** Fee charged to the passenger when the policy applies. */
  passengerFeePaise: Paise;
  /** Free cancellation window after a driver is assigned. */
  freeWindowSeconds: number;
  /** After the driver arrives, the passenger may cancel free within this window. */
  arrivedGraceSeconds: number;
}

export interface CancellationInput {
  policy: CancellationPolicy;
  actor: RideActor;
  status: RideStatus;
  now: Date;
  driverAssignedAt?: Date | null;
  driverArrivedAt?: Date | null;
}

export interface CancellationDecision {
  feePaise: Paise;
  reason:
    | 'NOT_PASSENGER'
    | 'NO_DRIVER_YET'
    | 'WITHIN_FREE_WINDOW'
    | 'AFTER_FREE_WINDOW'
    | 'DRIVER_WAITED';
}

const seconds = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 1000);

/**
 * Decides the passenger cancellation fee. Only passenger-initiated
 * cancellations are charged; driver, system and admin cancellations are free
 * for the passenger.
 */
export function decideCancellationFee(input: CancellationInput): CancellationDecision {
  const { policy, now } = input;
  assertPaise(policy.passengerFeePaise, 'passengerFeePaise');
  if (input.actor !== 'PASSENGER') return { feePaise: 0, reason: 'NOT_PASSENGER' };
  if (input.status === 'REQUESTED' || input.status === 'SEARCHING' || !input.driverAssignedAt) {
    return { feePaise: 0, reason: 'NO_DRIVER_YET' };
  }
  if (input.status === 'DRIVER_ARRIVED' && input.driverArrivedAt) {
    return seconds(input.driverArrivedAt, now) > policy.arrivedGraceSeconds
      ? { feePaise: policy.passengerFeePaise, reason: 'DRIVER_WAITED' }
      : { feePaise: 0, reason: 'WITHIN_FREE_WINDOW' };
  }
  return seconds(input.driverAssignedAt, now) > policy.freeWindowSeconds
    ? { feePaise: policy.passengerFeePaise, reason: 'AFTER_FREE_WINDOW' }
    : { feePaise: 0, reason: 'WITHIN_FREE_WINDOW' };
}
