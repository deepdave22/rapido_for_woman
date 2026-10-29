import { Inject, Injectable } from '@nestjs/common';
import { TERMINAL_RIDE_STATUSES } from '@saheli/domain';
import { and, eq, notInArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.decorators';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import {
  driverAvailability,
  driverLocations,
  passengerProfiles,
  payments,
  pushTokens,
  ratings,
  rides,
  safetyIncidents,
  savedPlaces,
  sessions,
  supportMessages,
  supportTickets,
  trustedContacts,
  users,
} from '../database/schema';
import { EarningsService } from '../payments/earnings.service';

/**
 * Data-principal rights (DPDP): a copy of one's data, and account deletion.
 * Deletion removes identifying data now; ride, payment and safety records are
 * kept (anonymised) for the legally required period, which must be confirmed
 * with counsel (docs/LAUNCH_BLOCKERS.md L8).
 */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly earnings: EarningsService,
    private readonly audit: AuditService,
  ) {}

  async export(user: AuthUser) {
    const id = user.userId;
    const [profile] = await this.db
      .select({
        phone: users.phoneE164,
        fullName: users.fullName,
        email: users.email,
        preferredLanguage: users.preferredLanguage,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, id));
    const [passenger] = await this.db
      .select()
      .from(passengerProfiles)
      .where(eq(passengerProfiles.userId, id));
    const myRides = await this.db
      .select({
        id: rides.id,
        status: rides.status,
        role: sql<string>`CASE WHEN ${rides.passengerId} = ${id} THEN 'PASSENGER' ELSE 'DRIVER' END`,
        requestedAt: rides.requestedAt,
        pickupAddress: rides.pickupAddress,
        dropoffAddress: rides.dropoffAddress,
        finalTotalPaise: rides.finalTotalPaise,
        paymentMethod: rides.paymentMethod,
      })
      .from(rides)
      .where(or(eq(rides.passengerId, id), eq(rides.driverId, id)));
    await this.audit.record({
      actorType: 'USER',
      actorId: id,
      action: 'privacy.data_exported',
      entityType: 'user',
      entityId: id,
    });
    return {
      generatedAt: new Date().toISOString(),
      profile,
      consents: passenger
        ? { termsVersion: passenger.termsVersionAccepted, acceptedAt: passenger.termsAcceptedAt }
        : null,
      rides: myRides,
      payments: await this.db
        .select({
          id: payments.id,
          rideId: payments.rideId,
          amountPaise: payments.amountPaise,
          method: payments.method,
          status: payments.status,
          paidAt: payments.paidAt,
        })
        .from(payments)
        .where(eq(payments.payerUserId, id)),
      savedPlaces: await this.db
        .select({ label: savedPlaces.label, name: savedPlaces.name, address: savedPlaces.address })
        .from(savedPlaces)
        .where(eq(savedPlaces.userId, id)),
      trustedContacts: await this.db
        .select({ name: trustedContacts.name, phone: trustedContacts.phoneE164 })
        .from(trustedContacts)
        .where(eq(trustedContacts.userId, id)),
      ratingsGiven: await this.db
        .select({ rideId: ratings.rideId, stars: ratings.stars, comment: ratings.comment })
        .from(ratings)
        .where(eq(ratings.raterUserId, id)),
      supportTickets: await this.db
        .select({
          id: supportTickets.id,
          subject: supportTickets.subject,
          status: supportTickets.status,
          createdAt: supportTickets.createdAt,
        })
        .from(supportTickets)
        .where(eq(supportTickets.userId, id)),
      safetyReports: await this.db
        .select({
          id: safetyIncidents.id,
          type: safetyIncidents.type,
          status: safetyIncidents.status,
          createdAt: safetyIncidents.createdAt,
        })
        .from(safetyIncidents)
        .where(eq(safetyIncidents.reporterUserId, id)),
    };
  }

  async deleteAccount(user: AuthUser) {
    const id = user.userId;
    const [active] = await this.db
      .select({ id: rides.id })
      .from(rides)
      .where(
        and(
          or(eq(rides.passengerId, id), eq(rides.driverId, id)),
          notInArray(rides.status, [...TERMINAL_RIDE_STATUSES]),
        ),
      )
      .limit(1);
    if (active) throw new AppError(409, 'ACTIVE_RIDE', 'Finish or cancel your current ride first');
    const [unpaid] = await this.db
      .select({ id: rides.id })
      .from(rides)
      .where(and(eq(rides.passengerId, id), sql`${rides.paymentStatus} IN ('PENDING','FAILED')`))
      .limit(1);
    if (unpaid)
      throw new AppError(
        409,
        'OUTSTANDING_PAYMENT',
        'Please settle your outstanding payment first',
      );
    if (user.roles.includes('DRIVER')) {
      const balance = await this.earnings.balance(id);
      if (balance.netPaise !== 0) {
        throw new AppError(
          409,
          'OUTSTANDING_BALANCE',
          'Your earnings balance must be settled before deletion',
          {
            netPaise: balance.netPaise,
          },
        );
      }
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          status: 'DELETED',
          phoneE164: `deleted:${id}`,
          fullName: null,
          email: null,
          dateOfBirth: null,
          profilePhotoKey: null,
          deletedAt: new Date(),
        })
        .where(eq(users.id, id));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'account_deleted' })
        .where(eq(sessions.userId, id));
      await tx.delete(pushTokens).where(eq(pushTokens.userId, id));
      await tx.delete(trustedContacts).where(eq(trustedContacts.userId, id));
      await tx.delete(savedPlaces).where(eq(savedPlaces.userId, id));
      await tx
        .update(driverAvailability)
        .set({ isOnline: false })
        .where(eq(driverAvailability.driverId, id));
      await tx.delete(driverLocations).where(eq(driverLocations.driverId, id));
      // Free-text the user wrote may identify them; keep the record, drop the words.
      await tx.update(ratings).set({ comment: null }).where(eq(ratings.raterUserId, id));
      await tx
        .update(supportMessages)
        .set({ body: '[removed at account deletion]' })
        .where(eq(supportMessages.authorUserId, id));
      await this.audit.record(
        {
          actorType: 'USER',
          actorId: id,
          action: 'privacy.account_deleted',
          entityType: 'user',
          entityId: id,
        },
        tx,
      );
    });
    return { deleted: true };
  }
}
