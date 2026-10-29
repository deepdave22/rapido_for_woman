import { Inject, Injectable } from '@nestjs/common';
import {
  DRIVER_ENGAGED_STATUSES,
  normalizeIndianMobile,
  RIDE_STATUSES,
  TERMINAL_RIDE_STATUSES,
} from '@saheli/domain';
import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.decorators';
import { AppError } from '../common/errors';
import { keyedHash, randomToken } from '../common/hashing';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import {
  driverLocations,
  driverProfiles,
  incidentEvents,
  ratings,
  rides,
  safetyIncidents,
  tripShares,
  trustedContacts,
  users,
  vehicles,
} from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportIncidentDto, SosDto, TrustedContactDto } from './safety.dto';

const MAX_TRUSTED_CONTACTS = 5;
const SHARE_TTL_MS = 6 * 60 * 60 * 1000;
/** A public trip link stops working this long after the ride ends. */
const SHARE_GRACE_AFTER_END_MS = 30 * 60 * 1000;
const SOS_DEDUPE_MS = 15 * 60 * 1000;
const PASSENGER_ACTIVE = RIDE_STATUSES.filter((s) => !TERMINAL_RIDE_STATUSES.includes(s));

const SEVERITY: Record<ReportIncidentDto['type'], 'HIGH' | 'MEDIUM' | 'LOW'> = {
  HARASSMENT: 'HIGH',
  ROUTE_DEVIATION: 'HIGH',
  VEHICLE_MISMATCH: 'HIGH',
  UNSAFE_DRIVING: 'MEDIUM',
  OTHER: 'LOW',
};

type RideRow = typeof rides.$inferSelect;

@Injectable()
export class SafetyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly env: Env,
  ) {}

  // ---------- trusted contacts ----------

  async listContacts(userId: string) {
    return this.db
      .select({
        id: trustedContacts.id,
        name: trustedContacts.name,
        phone: trustedContacts.phoneE164,
        relationship: trustedContacts.relationship,
      })
      .from(trustedContacts)
      .where(eq(trustedContacts.userId, userId))
      .orderBy(trustedContacts.createdAt);
  }

  async addContact(userId: string, dto: TrustedContactDto) {
    const phone = normalizeIndianMobile(dto.phone);
    const [{ n }] = (await this.db
      .select({ n: count() })
      .from(trustedContacts)
      .where(eq(trustedContacts.userId, userId))) as [{ n: number }];
    if (n >= MAX_TRUSTED_CONTACTS) {
      throw new AppError(
        422,
        'TOO_MANY_CONTACTS',
        `You can add up to ${MAX_TRUSTED_CONTACTS} trusted contacts`,
      );
    }
    const [own] = await this.db
      .select({ phone: users.phoneE164 })
      .from(users)
      .where(eq(users.id, userId));
    if (own?.phone === phone)
      throw new AppError(422, 'OWN_NUMBER', 'Add someone other than yourself');
    const [row] = await this.db
      .insert(trustedContacts)
      .values({ userId, name: dto.name, phoneE164: phone, relationship: dto.relationship ?? null })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError(409, 'CONTACT_EXISTS', 'This contact is already saved');
    return { id: row.id, name: row.name, phone: row.phoneE164, relationship: row.relationship };
  }

  async removeContact(userId: string, id: string) {
    const deleted = await this.db
      .delete(trustedContacts)
      .where(and(eq(trustedContacts.id, id), eq(trustedContacts.userId, userId)))
      .returning({ id: trustedContacts.id });
    if (!deleted.length) throw new AppError(404, 'NOT_FOUND', 'Contact not found');
  }

  // ---------- SOS and reports ----------

  /**
   * Raises an SOS. Always records it, even with no ride or location. The
   * response states plainly what happened: the incident is with the safety
   * team, and whether trusted contacts could actually be messaged.
   */
  async sos(user: AuthUser, dto: SosDto) {
    const ride = dto.rideId
      ? await this.participantRide(user, dto.rideId)
      : await this.currentRide(user);
    const location =
      dto.lat !== undefined && dto.lng !== undefined
        ? { lat: dto.lat, lng: dto.lng }
        : ride?.driverId
          ? await this.driverLocation(ride.driverId).then((l) =>
              l ? { lat: l.lat, lng: l.lng } : null,
            )
          : null;

    const [existing] = await this.db
      .select()
      .from(safetyIncidents)
      .where(
        and(
          eq(safetyIncidents.reporterUserId, user.userId),
          eq(safetyIncidents.type, 'SOS'),
          inArray(safetyIncidents.status, ['OPEN', 'ACKNOWLEDGED', 'RESPONDING']),
          ride ? eq(safetyIncidents.rideId, ride.id) : isNull(safetyIncidents.rideId),
          gt(safetyIncidents.createdAt, new Date(Date.now() - SOS_DEDUPE_MS)),
        ),
      )
      .limit(1);
    if (existing) {
      if (location) {
        await this.db
          .update(safetyIncidents)
          .set({ location })
          .where(eq(safetyIncidents.id, existing.id));
      }
      await this.db
        .insert(incidentEvents)
        .values({ incidentId: existing.id, action: 'SOS_REPEATED' });
      return { ...(await this.sosResponse(existing.id, user, null)), duplicate: true };
    }

    const incident = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(safetyIncidents)
        .values({
          rideId: ride?.id ?? null,
          reporterUserId: user.userId,
          reporterRole: user.app,
          type: 'SOS',
          severity: 'CRITICAL',
          location,
        })
        .returning();
      await tx.insert(incidentEvents).values({ incidentId: row!.id, action: 'CREATED' });
      await this.audit.record(
        {
          actorType: 'USER',
          actorId: user.userId,
          action: 'safety.sos_raised',
          entityType: 'safety_incident',
          entityId: row!.id,
          metadata: { rideId: ride?.id ?? null, hasLocation: !!location },
        },
        tx,
      );
      return row!;
    });

    const contactResult = await this.alertTrustedContacts(user, ride, incident.id);
    return { ...(await this.sosResponse(incident.id, user, contactResult)), duplicate: false };
  }

  private async alertTrustedContacts(user: AuthUser, ride: RideRow | null, incidentId: string) {
    const contacts = await this.db
      .select()
      .from(trustedContacts)
      .where(eq(trustedContacts.userId, user.userId));
    if (!contacts.length) return { saved: 0, sent: 0, status: 'NO_CONTACTS_SAVED' as const };
    const link = ride ? (await this.createShare(user.userId, ride.id, ride)).url : null;
    const [me] = await this.db
      .select({ name: users.fullName })
      .from(users)
      .where(eq(users.id, user.userId));
    let sent = 0;
    let lastReason: string | undefined;
    for (const c of contacts) {
      const result = await this.notifications.send({
        recipientPhoneE164: c.phoneE164,
        channel: 'SMS',
        template: 'sos_trusted_contact',
        payload: { incidentId, name: me?.name ?? 'Your contact', tripLink: link },
      });
      if (result.outcome === 'SENT') sent++;
      else lastReason = result.reason;
    }
    return {
      saved: contacts.length,
      sent,
      status:
        sent === contacts.length
          ? ('SENT' as const)
          : sent > 0
            ? ('PARTIAL' as const)
            : ('NOT_SENT' as const),
      reason: sent === contacts.length ? undefined : lastReason,
    };
  }

  private async sosResponse(
    incidentId: string,
    user: AuthUser,
    contacts: Awaited<ReturnType<SafetyService['alertTrustedContacts']>> | null,
  ) {
    const incident = await this.incidentForReporter(user.userId, incidentId);
    return {
      incident,
      trustedContacts: contacts,
      // Exactly what is true, no more.
      message:
        incident.responseInitiatedAt !== null
          ? 'Our safety team is responding.'
          : 'Your alert has reached our safety team. If you are in immediate danger, call 112.',
      emergencyNumber: '112',
    };
  }

  async report(user: AuthUser, dto: ReportIncidentDto) {
    const ride = dto.rideId ? await this.participantRide(user, dto.rideId) : null;
    const [row] = await this.db
      .insert(safetyIncidents)
      .values({
        rideId: ride?.id ?? null,
        reporterUserId: user.userId,
        reporterRole: user.app,
        type: dto.type,
        severity: SEVERITY[dto.type],
        description: dto.description,
      })
      .returning();
    await this.db.insert(incidentEvents).values({ incidentId: row!.id, action: 'CREATED' });
    await this.audit.record({
      actorType: 'USER',
      actorId: user.userId,
      action: 'safety.incident_reported',
      entityType: 'safety_incident',
      entityId: row!.id,
      metadata: { type: dto.type },
    });
    return this.incidentForReporter(user.userId, row!.id);
  }

  async myIncidents(userId: string) {
    const rows = await this.db
      .select({ id: safetyIncidents.id })
      .from(safetyIncidents)
      .where(eq(safetyIncidents.reporterUserId, userId))
      .orderBy(desc(safetyIncidents.createdAt))
      .limit(50);
    return Promise.all(rows.map((r) => this.incidentForReporter(userId, r.id)));
  }

  /** The reporter sees status and the timeline of actions, never staff notes. */
  async incidentForReporter(userId: string, id: string) {
    const [i] = await this.db
      .select()
      .from(safetyIncidents)
      .where(and(eq(safetyIncidents.id, id), eq(safetyIncidents.reporterUserId, userId)));
    if (!i) throw new AppError(404, 'NOT_FOUND', 'Incident not found');
    const events = await this.db
      .select({ action: incidentEvents.action, at: incidentEvents.createdAt })
      .from(incidentEvents)
      .where(eq(incidentEvents.incidentId, id))
      .orderBy(incidentEvents.id);
    return {
      id: i.id,
      type: i.type,
      severity: i.severity,
      status: i.status,
      rideId: i.rideId,
      createdAt: i.createdAt,
      acknowledgedAt: i.acknowledgedAt,
      responseInitiatedAt: i.responseInitiatedAt,
      resolvedAt: i.resolvedAt,
      timeline: events,
    };
  }

  // ---------- trip sharing ----------

  async createShare(userId: string, rideId: string, preloaded?: RideRow) {
    const ride = preloaded ?? (await this.db.select().from(rides).where(eq(rides.id, rideId)))[0];
    if (!ride || ride.passengerId !== userId)
      throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    if (TERMINAL_RIDE_STATUSES.includes(ride.status)) {
      throw new AppError(409, 'RIDE_ENDED', 'This ride has ended');
    }
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + SHARE_TTL_MS);
    await this.db.insert(tripShares).values({
      rideId,
      createdBy: userId,
      tokenHash: keyedHash(this.env.HASH_PEPPER, token),
      expiresAt,
    });
    return { url: `${this.env.SHARE_LINK_BASE_URL}${token}`, expiresAt };
  }

  async revokeShares(userId: string, rideId: string) {
    const [ride] = await this.db
      .select({ passengerId: rides.passengerId })
      .from(rides)
      .where(eq(rides.id, rideId));
    if (!ride || ride.passengerId !== userId)
      throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    await this.db
      .update(tripShares)
      .set({ revokedAt: new Date() })
      .where(and(eq(tripShares.rideId, rideId), isNull(tripShares.revokedAt)));
  }

  /**
   * Public view behind a share link: enough to follow the trip and identify
   * the vehicle, nothing more (no phone numbers, no passenger identity).
   */
  async publicTrip(token: string) {
    const [share] = await this.db
      .select()
      .from(tripShares)
      .where(
        and(
          eq(tripShares.tokenHash, keyedHash(this.env.HASH_PEPPER, token)),
          isNull(tripShares.revokedAt),
          gt(tripShares.expiresAt, new Date()),
        ),
      );
    if (!share) throw new AppError(404, 'LINK_EXPIRED', 'This trip link has expired');
    const [ride] = await this.db.select().from(rides).where(eq(rides.id, share.rideId));
    const endedAt = ride?.completedAt ?? ride?.cancelledAt;
    if (!ride || (endedAt && Date.now() - endedAt.getTime() > SHARE_GRACE_AFTER_END_MS)) {
      throw new AppError(404, 'LINK_EXPIRED', 'This trip link has expired');
    }
    let driver = null;
    if (ride.driverId) {
      const [d] = await this.db
        .select({
          name: users.fullName,
          reg: vehicles.registrationNumber,
          make: vehicles.make,
          model: vehicles.model,
          colour: vehicles.colour,
        })
        .from(driverProfiles)
        .innerJoin(users, eq(users.id, driverProfiles.userId))
        .leftJoin(vehicles, eq(vehicles.id, ride.vehicleId ?? sql`NULL`))
        .where(eq(driverProfiles.userId, ride.driverId));
      const live = DRIVER_ENGAGED_STATUSES.includes(ride.status)
        ? await this.driverLocation(ride.driverId)
        : null;
      driver = {
        firstName: d?.name?.split(' ')[0] ?? null,
        vehicle: d?.reg
          ? { registrationNumber: d.reg, make: d.make, model: d.model, colour: d.colour }
          : null,
        location: live,
      };
    }
    return {
      status: ride.status,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      startedAt: ride.startedAt,
      completedAt: ride.completedAt,
      driver,
      emergencyNumber: '112',
    };
  }

  // ---------- ratings ----------

  async rate(user: AuthUser, rideId: string, stars: number, comment?: string) {
    const ride = await this.participantRide(user, rideId);
    if (ride.status !== 'COMPLETED' || !ride.driverId) {
      throw new AppError(409, 'RIDE_NOT_COMPLETED', 'You can rate a ride after it is completed');
    }
    if (ride.completedAt && Date.now() - ride.completedAt.getTime() > 7 * 86_400_000) {
      throw new AppError(
        409,
        'RATING_WINDOW_CLOSED',
        'Ratings can be given for 7 days after a ride',
      );
    }
    const rateeUserId = user.app === 'PASSENGER' ? ride.driverId : ride.passengerId;
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(ratings).values({
          rideId,
          raterUserId: user.userId,
          rateeUserId,
          raterRole: user.app,
          stars,
          comment: comment ?? null,
        });
        if (user.app === 'PASSENGER') {
          await tx
            .update(driverProfiles)
            .set({
              ratingSum: sql`${driverProfiles.ratingSum} + ${stars}`,
              ratingCount: sql`${driverProfiles.ratingCount} + 1`,
            })
            .where(eq(driverProfiles.userId, rateeUserId));
        }
      });
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new AppError(409, 'ALREADY_RATED', 'You have already rated this ride');
      }
      throw err;
    }
    return { rideId, stars };
  }

  // ---------- helpers ----------

  /** Ride the caller took part in, or 404 (never reveal other people's rides). */
  private async participantRide(user: AuthUser, rideId: string): Promise<RideRow> {
    const [ride] = await this.db.select().from(rides).where(eq(rides.id, rideId));
    const isParticipant =
      ride &&
      (user.app === 'PASSENGER' ? ride.passengerId === user.userId : ride.driverId === user.userId);
    if (!ride || !isParticipant) throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    return ride;
  }

  private async currentRide(user: AuthUser): Promise<RideRow | null> {
    const [ride] = await this.db
      .select()
      .from(rides)
      .where(
        user.app === 'PASSENGER'
          ? and(eq(rides.passengerId, user.userId), inArray(rides.status, PASSENGER_ACTIVE))
          : and(
              eq(rides.driverId, user.userId),
              inArray(rides.status, [...DRIVER_ENGAGED_STATUSES]),
            ),
      )
      .limit(1);
    return ride ?? null;
  }

  private async driverLocation(driverId: string) {
    const [loc] = await this.db
      .select({ location: driverLocations.location, recordedAt: driverLocations.recordedAt })
      .from(driverLocations)
      .where(eq(driverLocations.driverId, driverId));
    return loc ? { ...loc.location, recordedAt: loc.recordedAt } : null;
  }
}
