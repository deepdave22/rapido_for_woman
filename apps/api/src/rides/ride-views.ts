import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../database/database.module';
import { driverLocations, driverProfiles, users, vehicles } from '../database/schema';
import { RideRow } from './ride-state.service';

const PIN_VISIBLE_STATUSES = new Set(['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED']);
const DRIVER_VISIBLE_STATUSES = new Set([
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
]);

function baseView(ride: RideRow) {
  return {
    id: ride.id,
    status: ride.status,
    version: ride.version,
    categoryCode: ride.categoryCode,
    pickup: { ...ride.pickup, address: ride.pickupAddress },
    dropoff: { ...ride.dropoff, address: ride.dropoffAddress },
    quotedTotalPaise: ride.quotedTotalPaise,
    finalTotalPaise: ride.finalTotalPaise,
    finalBreakdown: ride.finalBreakdown,
    paymentMethod: ride.paymentMethod,
    paymentStatus: ride.paymentStatus,
    cancelledBy: ride.cancelledBy,
    cancellationReason: ride.cancellationReason,
    cancellationFeePaise: ride.cancellationFeePaise,
    requestedAt: ride.requestedAt,
    driverAssignedAt: ride.driverAssignedAt,
    driverArrivedAt: ride.driverArrivedAt,
    pickupVerifiedAt: ride.pickupVerifiedAt,
    startedAt: ride.startedAt,
    completedAt: ride.completedAt,
    cancelledAt: ride.cancelledAt,
  };
}

/**
 * What each participant may see. The passenger gets the trip PIN (until the
 * ride starts) and the driver's verified profile; the driver gets neither the
 * PIN nor the passenger's phone number or full name.
 */
@Injectable()
export class RideViews {
  constructor(@Inject(DB) private readonly db: Database) {}

  async forPassenger(ride: RideRow) {
    let driver = null;
    if (ride.driverId && DRIVER_VISIBLE_STATUSES.has(ride.status)) {
      const [d] = await this.db
        .select({
          fullName: users.fullName,
          ratingSum: driverProfiles.ratingSum,
          ratingCount: driverProfiles.ratingCount,
          status: driverProfiles.status,
        })
        .from(driverProfiles)
        .innerJoin(users, eq(users.id, driverProfiles.userId))
        .where(eq(driverProfiles.userId, ride.driverId));
      const [v] = ride.vehicleId
        ? await this.db
            .select({
              registrationNumber: vehicles.registrationNumber,
              make: vehicles.make,
              model: vehicles.model,
              colour: vehicles.colour,
            })
            .from(vehicles)
            .where(eq(vehicles.id, ride.vehicleId))
        : [];
      const [loc] =
        ride.status !== 'COMPLETED'
          ? await this.db
              .select({
                location: driverLocations.location,
                recordedAt: driverLocations.recordedAt,
              })
              .from(driverLocations)
              .where(eq(driverLocations.driverId, ride.driverId))
          : [];
      driver = {
        firstName: d?.fullName?.split(' ')[0] ?? null,
        verified: d?.status === 'APPROVED',
        rating: d && d.ratingCount > 0 ? Math.round((d.ratingSum / d.ratingCount) * 10) / 10 : null,
        ratingCount: d?.ratingCount ?? 0,
        vehicle: v ?? null,
        location: loc ? { ...loc.location, recordedAt: loc.recordedAt } : null,
      };
    }
    return {
      ...baseView(ride),
      pickupPin: PIN_VISIBLE_STATUSES.has(ride.status) ? ride.pickupPin : null,
      driver,
    };
  }

  async forDriver(ride: RideRow) {
    const [p] = await this.db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, ride.passengerId));
    return {
      ...baseView(ride),
      passenger: { firstName: p?.fullName?.split(' ')[0] ?? null },
      pickupPinAttempts: ride.pickupPinAttempts,
    };
  }
}
