import { Inject, Injectable } from '@nestjs/common';
import { DRIVER_ENGAGED_STATUSES } from '@saheli/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ClientInfo } from '../auth/auth.service';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import {
  driverAvailability,
  driverDocuments,
  driverLocations,
  driverProfiles,
  driverVerifications,
  rideLocationPoints,
  rides,
  users,
  vehicles,
} from '../database/schema';
import { ObjectStorage, sniffMimeType, STORAGE } from '../integrations/storage';
import { RealtimeService } from '../realtime/realtime.gateway';
import {
  DriverEligibilityService,
  REQUIRED_CHECKS,
  requiredDocuments,
} from './driver-eligibility.service';
import { LocationUpdateDto, UploadDocumentDto, UpsertVehicleDto } from './drivers.dto';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Fixes worse than this are not useful for dispatch or safety tracking. */
const MAX_ACCURACY_M = 100;
/** Minimum spacing between accepted location updates per driver. */
const MIN_UPDATE_INTERVAL_MS = 2000;

@Injectable()
export class DriversService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly eligibility: DriverEligibilityService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async onboarding(driverId: string) {
    const [profile] = await this.db
      .select({ status: driverProfiles.status, statusReason: driverProfiles.statusReason })
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driverId));
    if (!profile) throw new AppError(404, 'NOT_A_DRIVER', 'Driver profile not found');
    const [vehicle] = await this.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId))
      .orderBy(desc(vehicles.createdAt))
      .limit(1);
    const docs = await this.db
      .select({
        id: driverDocuments.id,
        type: driverDocuments.type,
        status: driverDocuments.status,
        expiresOn: driverDocuments.expiresOn,
        rejectionReason: driverDocuments.rejectionReason,
        createdAt: driverDocuments.createdAt,
      })
      .from(driverDocuments)
      .where(eq(driverDocuments.driverId, driverId))
      .orderBy(desc(driverDocuments.createdAt));
    const latestByType = new Map<string, (typeof docs)[number]>();
    for (const d of docs) if (!latestByType.has(d.type)) latestByType.set(d.type, d);

    const required = requiredDocuments(vehicle?.categoryCode ?? null);
    const missingDocuments = required.filter((t) => {
      const d = latestByType.get(t);
      return !d || d.status === 'REJECTED' || d.status === 'EXPIRED';
    });
    const checks = await this.db
      .select({ check: driverVerifications.check, status: driverVerifications.status })
      .from(driverVerifications)
      .where(eq(driverVerifications.driverId, driverId))
      .orderBy(desc(driverVerifications.createdAt));
    const latestChecks = REQUIRED_CHECKS.map((check) => ({
      check,
      status: checks.find((c) => c.check === check)?.status ?? 'NOT_STARTED',
    }));
    const [user] = await this.db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, driverId));

    return {
      status: profile.status,
      statusReason: profile.statusReason,
      vehicle: vehicle
        ? {
            id: vehicle.id,
            categoryCode: vehicle.categoryCode,
            registrationNumber: vehicle.registrationNumber,
            make: vehicle.make,
            model: vehicle.model,
            colour: vehicle.colour,
            status: vehicle.status,
          }
        : null,
      documents: [...latestByType.values()].map(({ createdAt: _c, ...d }) => d),
      requiredDocuments: required,
      missingDocuments,
      checks: latestChecks,
      canSubmit:
        (profile.status === 'ONBOARDING' || profile.status === 'REJECTED') &&
        !!vehicle &&
        !!user?.fullName &&
        missingDocuments.length === 0,
    };
  }

  async upsertVehicle(driverId: string, dto: UpsertVehicleDto, client: ClientInfo) {
    await this.assertEditable(driverId);
    const registrationNumber = dto.registrationNumber.replace(/[\s-]/g, '').toUpperCase();
    const values = {
      categoryCode: dto.categoryCode,
      registrationNumber,
      make: dto.make,
      model: dto.model,
      colour: dto.colour,
      manufactureYear: dto.manufactureYear ?? null,
      status: 'PENDING_REVIEW' as const,
    };
    const [existing] = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId))
      .limit(1);
    try {
      const [vehicle] = existing
        ? await this.db.update(vehicles).set(values).where(eq(vehicles.id, existing.id)).returning()
        : await this.db
            .insert(vehicles)
            .values({ driverId, ...values })
            .returning();
      await this.audit.record({
        actorType: 'USER',
        actorId: driverId,
        action: existing ? 'driver.vehicle_updated' : 'driver.vehicle_added',
        entityType: 'vehicle',
        entityId: vehicle!.id,
        ...client,
      });
      return vehicle!;
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new AppError(409, 'VEHICLE_ALREADY_REGISTERED', 'This vehicle is already registered');
      }
      throw err;
    }
  }

  async uploadDocument(
    driverId: string,
    dto: UploadDocumentDto,
    file: { buffer: Buffer; size: number } | undefined,
    client: ClientInfo,
  ) {
    const [profile] = await this.db
      .select({ status: driverProfiles.status })
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driverId));
    if (!profile) throw new AppError(404, 'NOT_A_DRIVER', 'Driver profile not found');
    if (profile.status === 'SUSPENDED' || profile.status === 'PENDING_REVIEW') {
      throw new AppError(409, 'DOCUMENTS_LOCKED', 'Documents cannot be changed right now');
    }
    if (!file || file.size === 0) throw new AppError(400, 'FILE_REQUIRED', 'Attach a file');
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new AppError(413, 'FILE_TOO_LARGE', 'Files must be 10 MB or smaller');
    }
    const mimeType = sniffMimeType(file.buffer);
    if (!mimeType) {
      throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload a JPEG, PNG or PDF file');
    }
    if (dto.type === 'PROFILE_PHOTO' && mimeType === 'application/pdf') {
      throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'The profile photo must be a JPEG or PNG');
    }
    if (dto.expiresOn && dto.expiresOn < new Date().toISOString().slice(0, 10)) {
      throw new AppError(422, 'DOCUMENT_EXPIRED', 'This document has already expired');
    }

    const id = randomUUID();
    // Key is server-generated: no user-controlled path components.
    const storageKey = `driver-documents/${driverId}/${id}`;
    await this.storage.put(storageKey, file.buffer, mimeType);
    const [doc] = await this.db
      .insert(driverDocuments)
      .values({
        id,
        driverId,
        type: dto.type,
        storageKey,
        mimeType,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        expiresOn: dto.expiresOn ?? null,
      })
      .returning({
        id: driverDocuments.id,
        type: driverDocuments.type,
        status: driverDocuments.status,
        expiresOn: driverDocuments.expiresOn,
      });
    await this.audit.record({
      actorType: 'USER',
      actorId: driverId,
      action: 'driver.document_uploaded',
      entityType: 'driver_document',
      entityId: id,
      ...client,
      metadata: { type: dto.type },
    });
    return doc!;
  }

  async submitForReview(driverId: string, client: ClientInfo) {
    const state = await this.onboarding(driverId);
    if (!state.canSubmit) {
      throw new AppError(422, 'ONBOARDING_INCOMPLETE', 'Complete every step before submitting', {
        missingDocuments: state.missingDocuments,
        vehicle: !!state.vehicle,
        status: state.status,
      });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(driverProfiles)
        .set({ status: 'PENDING_REVIEW', submittedAt: new Date(), statusReason: null })
        .where(eq(driverProfiles.userId, driverId));
      await tx
        .insert(driverVerifications)
        .values(REQUIRED_CHECKS.map((check) => ({ driverId, check, status: 'PENDING' as const })));
      await this.audit.record(
        {
          actorType: 'USER',
          actorId: driverId,
          action: 'driver.submitted_for_review',
          entityType: 'driver',
          entityId: driverId,
          ...client,
        },
        tx,
      );
    });
    return this.onboarding(driverId);
  }

  async setAvailability(driverId: string, online: boolean, client: ClientInfo) {
    if (online) {
      const result = await this.eligibility.check(driverId);
      if (!result.eligible) {
        throw new AppError(403, 'NOT_ELIGIBLE_TO_DRIVE', 'You cannot go online yet', {
          reasons: result.reasons,
        });
      }
      await this.db
        .update(driverAvailability)
        .set({ isOnline: true, vehicleId: result.vehicleId, wentOnlineAt: new Date() })
        .where(eq(driverAvailability.driverId, driverId));
    } else {
      const updated = await this.db
        .update(driverAvailability)
        .set({ isOnline: false })
        .where(
          and(
            eq(driverAvailability.driverId, driverId),
            sql`${driverAvailability.activeRideId} IS NULL`,
          ),
        )
        .returning({ driverId: driverAvailability.driverId });
      if (!updated.length) {
        throw new AppError(
          409,
          'ACTIVE_RIDE',
          'Finish or cancel your current ride before going offline',
        );
      }
      // Stop holding a location for drivers who are not working.
      await this.db.delete(driverLocations).where(eq(driverLocations.driverId, driverId));
    }
    await this.audit.record({
      actorType: 'USER',
      actorId: driverId,
      action: online ? 'driver.went_online' : 'driver.went_offline',
      entityType: 'driver',
      entityId: driverId,
      ...client,
    });
    return { online };
  }

  /**
   * Ingests a GPS fix. Rejects stale, future-dated or inaccurate fixes and
   * thins bursts. Forwards the position only to the passenger of the driver's
   * current ride.
   */
  async updateLocation(driverId: string, dto: LocationUpdateDto): Promise<{ accepted: boolean }> {
    const recordedAt = new Date(dto.recordedAt);
    const now = Date.now();
    if (recordedAt.getTime() > now + 30_000) {
      throw new AppError(422, 'LOCATION_IN_FUTURE', 'Device clock is ahead; location rejected');
    }
    if (recordedAt.getTime() < now - 120_000) {
      throw new AppError(422, 'LOCATION_STALE', 'Location is too old');
    }
    if (dto.accuracyM > MAX_ACCURACY_M) {
      throw new AppError(422, 'LOCATION_INACCURATE', 'GPS accuracy is too low');
    }

    const [availability] = await this.db
      .select({ isOnline: driverAvailability.isOnline })
      .from(driverAvailability)
      .where(eq(driverAvailability.driverId, driverId));
    if (!availability?.isOnline) {
      throw new AppError(409, 'DRIVER_OFFLINE', 'Go online to share your location');
    }

    const point = sql`ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)::geography`;
    // Upsert, skipping fixes that are older than or too close to the stored one.
    const result = await this.db.execute(sql`
      INSERT INTO driver_locations (driver_id, location, heading_deg, speed_mps, accuracy_m, recorded_at, received_at)
      VALUES (${driverId}, ${point}, ${dto.headingDeg ?? null}, ${dto.speedMps ?? null}, ${dto.accuracyM}, ${recordedAt.toISOString()}, now())
      ON CONFLICT (driver_id) DO UPDATE SET
        location = EXCLUDED.location, heading_deg = EXCLUDED.heading_deg, speed_mps = EXCLUDED.speed_mps,
        accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at, received_at = now()
      WHERE driver_locations.recorded_at < EXCLUDED.recorded_at
        AND driver_locations.received_at < now() - make_interval(secs => ${MIN_UPDATE_INTERVAL_MS / 1000})`);
    if (!result.rowCount) return { accepted: false };

    const [ride] = await this.db
      .select({ id: rides.id, passengerId: rides.passengerId, status: rides.status })
      .from(rides)
      .where(and(eq(rides.driverId, driverId), inArray(rides.status, [...DRIVER_ENGAGED_STATUSES])))
      .limit(1);
    if (ride) {
      if (ride.status === 'IN_PROGRESS') {
        await this.db.insert(rideLocationPoints).values({
          rideId: ride.id,
          location: { lat: dto.lat, lng: dto.lng },
          accuracyM: Math.round(dto.accuracyM),
          recordedAt,
        });
      }
      this.realtime.toUser(ride.passengerId, 'driver.location', {
        rideId: ride.id,
        lat: dto.lat,
        lng: dto.lng,
        headingDeg: dto.headingDeg ?? null,
        recordedAt: recordedAt.toISOString(),
      });
    }
    return { accepted: true };
  }

  private async assertEditable(driverId: string): Promise<void> {
    const [profile] = await this.db
      .select({ status: driverProfiles.status })
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driverId));
    if (!profile) throw new AppError(404, 'NOT_A_DRIVER', 'Driver profile not found');
    if (profile.status !== 'ONBOARDING' && profile.status !== 'REJECTED') {
      throw new AppError(
        409,
        'PROFILE_LOCKED',
        'Contact support to change your vehicle after review',
      );
    }
  }
}
