import type { RideStatus } from '@saheli/domain';

export { formatInr, formatIndianMobile, maskIndianMobile } from '@saheli/domain';

/** "4.9 km" / "800 m". */
export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
}

/** "3 min" / "1 h 5 min". Never shows less than a minute. */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const PASSENGER_STATUS_TEXT: Record<RideStatus, string> = {
  REQUESTED: 'Booking your ride',
  SEARCHING: 'Finding a verified driver near you',
  DRIVER_ASSIGNED: 'Driver assigned',
  DRIVER_ARRIVING: 'Driver is on the way',
  DRIVER_ARRIVED: 'Driver has arrived. Share your PIN only in person',
  IN_PROGRESS: 'On the way to your destination',
  COMPLETED: 'Ride completed',
  CANCELLED: 'Ride cancelled',
  NO_DRIVER_FOUND: 'No driver available right now',
};

export function passengerStatusText(status: RideStatus): string {
  return PASSENGER_STATUS_TEXT[status];
}

/** Human message for an API error code, falling back to the server's message. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}
