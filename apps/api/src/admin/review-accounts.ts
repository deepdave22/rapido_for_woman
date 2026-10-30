import { normalizeIndianMobile } from '@saheli/domain';
import { and, eq } from 'drizzle-orm';
import { Database, Tx } from '../database/database.module';
import {
  driverAvailability,
  driverDocuments,
  driverProfiles,
  driverVerifications,
  passengerProfiles,
  serviceCategories,
  userRoles,
  users,
  vehicles,
} from '../database/schema';
import { REQUIRED_CHECKS, requiredDocuments } from '../drivers/driver-eligibility.service';

export type ReviewCategory = 'BIKE' | 'AUTO' | 'CAB';

/** Marks every placeholder so staff never mistake it for a real check or document. */
const NOT_REAL = 'App-store review account: placeholder, not a real verification';

/**
 * Creates (or refreshes) the accounts app-store reviewers sign in with. Safe to
 * re-run, e.g. after a reviewer tests account deletion. Refuses to touch an
 * existing real account, so it can never turn a real person into a review account.
 */
export async function provisionReviewAccounts(
  db: Database,
  opts: { passengerPhone?: string; driverPhone?: string; category?: ReviewCategory },
): Promise<{ passengerId?: string; driverId?: string }> {
  return db.transaction(async (tx) => {
    const result: { passengerId?: string; driverId?: string } = {};
    if (opts.passengerPhone) {
      const id = await reviewUser(tx, opts.passengerPhone, 'App Review Passenger');
      await tx.insert(userRoles).values({ userId: id, role: 'PASSENGER' }).onConflictDoNothing();
      await tx.insert(passengerProfiles).values({ userId: id }).onConflictDoNothing();
      result.passengerId = id;
    }
    if (opts.driverPhone) {
      result.driverId = await approvedReviewDriver(tx, opts.driverPhone, opts.category ?? 'AUTO');
    }
    return result;
  });
}

async function reviewUser(tx: Tx, rawPhone: string, fullName: string): Promise<string> {
  const phoneE164 = normalizeIndianMobile(rawPhone);
  const [existing] = await tx
    .select({ id: users.id, review: users.isReviewAccount })
    .from(users)
    .where(eq(users.phoneE164, phoneE164));
  if (existing && !existing.review) {
    throw new Error(
      `${phoneE164} already belongs to a real account. Use a number the company controls that has never signed up.`,
    );
  }
  if (existing) {
    await tx
      .update(users)
      .set({ status: 'ACTIVE', suspendedReason: null, fullName })
      .where(eq(users.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(users)
    .values({ phoneE164, fullName, isReviewAccount: true })
    .returning({ id: users.id });
  return created!.id;
}

async function approvedReviewDriver(
  tx: Tx,
  phone: string,
  category: ReviewCategory,
): Promise<string> {
  const [known] = await tx
    .select({ code: serviceCategories.code })
    .from(serviceCategories)
    .where(eq(serviceCategories.code, category));
  if (!known) {
    throw new Error(`Service category ${category} does not exist. Run "npm run db:seed" first.`);
  }
  const id = await reviewUser(tx, phone, 'App Review Driver');
  await tx.insert(userRoles).values({ userId: id, role: 'DRIVER' }).onConflictDoNothing();
  await tx.insert(driverProfiles).values({ userId: id }).onConflictDoNothing();

  const registrationNumber = `REVIEW${id.slice(0, 4).toUpperCase()}`;
  let [vehicle] = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.driverId, id), eq(vehicles.categoryCode, category)));
  if (!vehicle) {
    [vehicle] = await tx
      .insert(vehicles)
      .values({
        driverId: id,
        categoryCode: category,
        registrationNumber,
        make: 'Review',
        model: 'Placeholder',
        colour: 'White',
        status: 'ACTIVE',
      })
      .returning({ id: vehicles.id });
  }
  await tx
    .insert(driverAvailability)
    .values({ driverId: id, vehicleId: vehicle!.id })
    .onConflictDoUpdate({ target: driverAvailability.driverId, set: { vehicleId: vehicle!.id } });

  const docs = await tx
    .select({ type: driverDocuments.type })
    .from(driverDocuments)
    .where(and(eq(driverDocuments.driverId, id), eq(driverDocuments.status, 'APPROVED')));
  for (const type of requiredDocuments(category)) {
    if (docs.some((d) => d.type === type)) continue;
    await tx.insert(driverDocuments).values({
      driverId: id,
      type,
      storageKey: `review-account/${id}/${type}`,
      // No file is stored; the row only satisfies eligibility for this sandboxed account.
      mimeType: 'application/octet-stream',
      sizeBytes: 1,
      sha256: 'review-account-placeholder',
      status: 'APPROVED',
    });
  }
  const checks = await tx
    .select({ check: driverVerifications.check })
    .from(driverVerifications)
    .where(and(eq(driverVerifications.driverId, id), eq(driverVerifications.status, 'PASSED')));
  for (const check of REQUIRED_CHECKS) {
    if (checks.some((c) => c.check === check)) continue;
    await tx.insert(driverVerifications).values({
      driverId: id,
      check,
      status: 'PASSED',
      provider: 'review-account',
      notes: NOT_REAL,
    });
  }
  await tx
    .update(driverProfiles)
    .set({ status: 'APPROVED', approvedAt: new Date() })
    .where(eq(driverProfiles.userId, id));
  return id;
}
