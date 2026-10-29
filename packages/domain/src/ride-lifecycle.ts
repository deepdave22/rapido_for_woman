import { DomainError } from './errors';

export const RIDE_STATUSES = [
  'REQUESTED',
  'SEARCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVER_FOUND',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const RIDE_ACTORS = ['PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN'] as const;
export type RideActor = (typeof RIDE_ACTORS)[number];

export const TERMINAL_RIDE_STATUSES: readonly RideStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVER_FOUND',
];

/** Statuses in which a driver is committed to the ride. */
export const DRIVER_ENGAGED_STATUSES: readonly RideStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];

/**
 * Allowed transitions and who may trigger each. A driver cancelling before
 * pickup sends the ride back to SEARCHING for reassignment rather than ending
 * it; the service decides whether retry limits allow that.
 *
 * Payment state is tracked separately (`rides.payment_status`) so a payment
 * failure never rewinds a completed trip. Disputes are support tickets.
 */
const TRANSITIONS: Readonly<Record<RideStatus, Partial<Record<RideStatus, readonly RideActor[]>>>> =
  {
    REQUESTED: {
      SEARCHING: ['SYSTEM'],
      CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'],
    },
    SEARCHING: {
      DRIVER_ASSIGNED: ['DRIVER'],
      NO_DRIVER_FOUND: ['SYSTEM'],
      CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'],
    },
    DRIVER_ASSIGNED: {
      DRIVER_ARRIVING: ['DRIVER', 'SYSTEM'],
      DRIVER_ARRIVED: ['DRIVER'],
      SEARCHING: ['DRIVER', 'SYSTEM', 'ADMIN'],
      CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'],
    },
    DRIVER_ARRIVING: {
      DRIVER_ARRIVED: ['DRIVER'],
      SEARCHING: ['DRIVER', 'SYSTEM', 'ADMIN'],
      CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'],
    },
    DRIVER_ARRIVED: {
      IN_PROGRESS: ['DRIVER'],
      SEARCHING: ['DRIVER', 'SYSTEM', 'ADMIN'],
      CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'],
    },
    IN_PROGRESS: {
      COMPLETED: ['DRIVER', 'ADMIN'],
      // Ending a trip mid-way is an operations/safety decision, never a unilateral one.
      CANCELLED: ['ADMIN'],
    },
    COMPLETED: {},
    CANCELLED: {},
    NO_DRIVER_FOUND: {},
  };

export interface TransitionContext {
  /** Required to start a trip: the driver entered the passenger's trip PIN. */
  pickupPinVerified?: boolean;
}

export function isTerminal(status: RideStatus): boolean {
  return TERMINAL_RIDE_STATUSES.includes(status);
}

export function allowedNextStatuses(from: RideStatus, actor: RideActor): RideStatus[] {
  const options = TRANSITIONS[from];
  return (Object.keys(options) as RideStatus[]).filter((to) => options[to]?.includes(actor));
}

/** Throws a DomainError unless `actor` may move a ride from `from` to `to`. */
export function assertRideTransition(
  from: RideStatus,
  to: RideStatus,
  actor: RideActor,
  context: TransitionContext = {},
): void {
  if (from === to) {
    throw new DomainError('RIDE_ALREADY_IN_STATUS', `Ride is already ${from}`);
  }
  const actors = TRANSITIONS[from][to];
  if (!actors) {
    throw new DomainError('INVALID_RIDE_TRANSITION', `Cannot move ride from ${from} to ${to}`);
  }
  if (!actors.includes(actor)) {
    throw new DomainError(
      'TRANSITION_NOT_PERMITTED',
      `${actor} cannot move ride from ${from} to ${to}`,
    );
  }
  if (to === 'IN_PROGRESS' && !context.pickupPinVerified) {
    throw new DomainError(
      'PICKUP_NOT_VERIFIED',
      'Trip PIN must be verified before the ride starts',
    );
  }
}
