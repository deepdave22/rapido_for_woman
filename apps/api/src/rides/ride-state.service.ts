import { Injectable } from '@nestjs/common';
import { assertRideTransition, RideActor, RideStatus } from '@saheli/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { Tx } from '../database/database.module';
import { driverAvailability, rideAssignments, rideEvents, rides } from '../database/schema';

export type RideRow = typeof rides.$inferSelect;
type RidePatch = Partial<Omit<typeof rides.$inferInsert, 'id' | 'status' | 'version'>>;

export interface TransitionRequest {
  rideId: string;
  to: RideStatus;
  actor: RideActor;
  actorId: string | null;
  reason?: string;
  /** Throws if the caller may not act on this ride. Runs after the row is locked. */
  authorize?: (ride: RideRow) => void;
  /** Extra checks against the locked row, and extra columns to set. */
  prepare?: (ride: RideRow) => RidePatch | Promise<RidePatch>;
  metadata?: Record<string, unknown>;
}

export interface TransitionResult {
  ride: RideRow;
  previous: RideStatus;
  /** Drivers whose pending offer was withdrawn by this transition. */
  withdrawnDrivers: string[];
}

/**
 * The only code path that changes a ride's status. Locks the row, validates the
 * transition against the domain state machine, writes the event, and releases
 * any driver reservations when a ride ends or goes back to searching.
 */
@Injectable()
export class RideStateService {
  async transition(tx: Tx, req: TransitionRequest): Promise<TransitionResult> {
    const [ride] = await tx.select().from(rides).where(eq(rides.id, req.rideId)).for('update');
    if (!ride) throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    req.authorize?.(ride);
    assertRideTransition(ride.status, req.to, req.actor, {
      pickupPinVerified: ride.pickupVerifiedAt !== null,
    });
    const patch = (await req.prepare?.(ride)) ?? {};

    const [updated] = await tx
      .update(rides)
      .set({ ...patch, status: req.to, version: sql`${rides.version} + 1` })
      .where(and(eq(rides.id, ride.id), eq(rides.version, ride.version)))
      .returning();
    if (!updated) throw new AppError(409, 'RIDE_CHANGED', 'The ride changed. Please refresh');

    await tx.insert(rideEvents).values({
      rideId: ride.id,
      fromStatus: ride.status,
      toStatus: req.to,
      actorType: req.actor,
      actorId: req.actorId,
      reason: req.reason ?? null,
      metadata: req.metadata ?? null,
    });

    let withdrawnDrivers: string[] = [];
    const ending = req.to === 'CANCELLED' || req.to === 'NO_DRIVER_FOUND' || req.to === 'COMPLETED';
    if (ending || req.to === 'SEARCHING') {
      // Back to searching voids the accepted offer too, so another driver can accept.
      const cancellable: ('OFFERED' | 'ACCEPTED')[] =
        req.to === 'SEARCHING' ? ['OFFERED', 'ACCEPTED'] : ['OFFERED'];
      const withdrawn = await tx
        .update(rideAssignments)
        .set({ status: 'CANCELLED', respondedAt: new Date() })
        .where(
          and(eq(rideAssignments.rideId, ride.id), inArray(rideAssignments.status, cancellable)),
        )
        .returning({ driverId: rideAssignments.driverId, status: rideAssignments.status });
      withdrawnDrivers = withdrawn.map((w) => w.driverId);
      await tx
        .update(driverAvailability)
        .set({ activeRideId: null })
        .where(eq(driverAvailability.activeRideId, ride.id));
    }
    return { ride: updated, previous: ride.status, withdrawnDrivers };
  }
}
