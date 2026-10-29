import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB, Database, Tx } from '../database/database.module';
import {
  driverDocuments,
  driverProfiles,
  driverVerifications,
  users,
  vehicles,
} from '../database/schema';

type DocumentType = (typeof driverDocuments.$inferSelect)['type'];
type VerificationCheck = (typeof driverVerifications.$inferSelect)['check'];

/**
 * Checks a driver must pass before going online. Which checks are legally
 * required (and how gender eligibility may be verified) is pending legal
 * review: see docs/LAUNCH_BLOCKERS.md L3, L9.
 */
export const REQUIRED_CHECKS: readonly VerificationCheck[] = [
  'IDENTITY',
  'GENDER_ELIGIBILITY',
  'DRIVING_LICENCE',
  'BACKGROUND',
];

const BASE_DOCUMENTS: readonly DocumentType[] = [
  'PROFILE_PHOTO',
  'IDENTITY_PROOF',
  'DRIVING_LICENCE',
  'VEHICLE_RC',
  'VEHICLE_INSURANCE',
];

/** Commercial permits by category. Confirm per state before launch (LAUNCH_BLOCKERS L4-L6). */
const CATEGORY_DOCUMENTS: Record<string, readonly DocumentType[]> = {
  BIKE: [],
  AUTO: ['VEHICLE_PERMIT'],
  CAB: ['VEHICLE_PERMIT'],
};

export function requiredDocuments(categoryCode: string | null): DocumentType[] {
  return [...BASE_DOCUMENTS, ...(categoryCode ? (CATEGORY_DOCUMENTS[categoryCode] ?? []) : [])];
}

export interface Eligibility {
  eligible: boolean;
  /** Machine-readable reasons, safe to show the driver. */
  reasons: string[];
  vehicleId: string | null;
}

@Injectable()
export class DriverEligibilityService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Whether the driver may go online and receive ride offers right now. */
  async check(driverId: string, tx?: Tx): Promise<Eligibility> {
    const q = tx ?? this.db;
    const reasons: string[] = [];
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const [profile] = await q
      .select({ status: driverProfiles.status, userStatus: users.status })
      .from(driverProfiles)
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .where(eq(driverProfiles.userId, driverId));
    if (!profile) return { eligible: false, reasons: ['NOT_A_DRIVER'], vehicleId: null };
    if (profile.userStatus !== 'ACTIVE') reasons.push('ACCOUNT_NOT_ACTIVE');
    if (profile.status !== 'APPROVED') reasons.push(`DRIVER_${profile.status}`);

    const checks = await q
      .select()
      .from(driverVerifications)
      .where(eq(driverVerifications.driverId, driverId))
      .orderBy(desc(driverVerifications.createdAt));
    for (const check of REQUIRED_CHECKS) {
      const latest = checks.find((c) => c.check === check);
      if (!latest || latest.status !== 'PASSED') reasons.push(`CHECK_${check}_NOT_PASSED`);
      else if (latest.expiresAt && latest.expiresAt <= now) reasons.push(`CHECK_${check}_EXPIRED`);
    }

    const [vehicle] = await q
      .select({ id: vehicles.id, status: vehicles.status, categoryCode: vehicles.categoryCode })
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId))
      .orderBy(desc(vehicles.createdAt))
      .limit(1);
    if (!vehicle) reasons.push('NO_VEHICLE');
    else if (vehicle.status !== 'ACTIVE') reasons.push('VEHICLE_NOT_ACTIVE');

    const docs = await q
      .select({
        type: driverDocuments.type,
        status: driverDocuments.status,
        expiresOn: driverDocuments.expiresOn,
      })
      .from(driverDocuments)
      .where(and(eq(driverDocuments.driverId, driverId)))
      .orderBy(desc(driverDocuments.createdAt));
    for (const type of requiredDocuments(vehicle?.categoryCode ?? null)) {
      const latest = docs.find((d) => d.type === type);
      if (!latest || latest.status !== 'APPROVED') reasons.push(`DOCUMENT_${type}_NOT_APPROVED`);
      else if (latest.expiresOn && latest.expiresOn < today)
        reasons.push(`DOCUMENT_${type}_EXPIRED`);
    }

    return { eligible: reasons.length === 0, reasons, vehicleId: vehicle?.id ?? null };
  }
}
