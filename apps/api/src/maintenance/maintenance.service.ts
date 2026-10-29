import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { DriverEligibilityService } from '../drivers/driver-eligibility.service';

export interface MaintenanceReport {
  otpChallenges: number;
  sessions: number;
  idempotencyRecords: number;
  tripShares: number;
  rideLocationPoints: number;
  documentsExpired: number;
  driversTakenOffline: number;
}

/**
 * Scheduled housekeeping: retention limits on personal and transient data,
 * and document expiry. Every run is idempotent and safe on several instances
 * (an advisory lock lets only one run at a time).
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Maintenance');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly env: Env,
    private readonly eligibility: DriverEligibilityService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    if (this.env.MAINTENANCE_INTERVAL_MS > 0) {
      this.timer = setInterval(() => {
        this.run().catch((err: unknown) => this.logger.error({ err }, 'Maintenance run failed'));
      }, this.env.MAINTENANCE_INTERVAL_MS);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<MaintenanceReport | null> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('maintenance')) AS locked`,
      );
      if (!rows[0]?.locked) return null;
      const count = async (q: ReturnType<typeof sql>) => (await tx.execute(q)).rowCount ?? 0;

      const report: MaintenanceReport = {
        otpChallenges: await count(
          sql`DELETE FROM otp_challenges WHERE created_at < now() - interval '1 day'`,
        ),
        sessions: await count(sql`DELETE FROM sessions
          WHERE (expires_at < now() - interval '30 days') OR (revoked_at < now() - interval '30 days')
             OR (rotated_at < now() - interval '30 days')`),
        idempotencyRecords: await count(
          sql`DELETE FROM idempotency_records WHERE expires_at < now()`,
        ),
        tripShares: await count(
          sql`DELETE FROM trip_shares WHERE expires_at < now() - interval '7 days'`,
        ),
        // Breadcrumbs kept for safety investigations; the period is a legal decision (LAUNCH_BLOCKERS L8).
        rideLocationPoints: await count(sql`DELETE FROM ride_location_points
          WHERE recorded_at < now() - make_interval(days => ${this.env.RETENTION_LOCATION_DAYS})`),
        documentsExpired: await count(sql`UPDATE driver_documents SET status = 'EXPIRED'
          WHERE status = 'APPROVED' AND expires_on IS NOT NULL
            AND expires_on < (now() AT TIME ZONE 'Asia/Kolkata')::date`),
        driversTakenOffline: 0,
      };

      // Drivers online but no longer eligible (expired document or check) go offline,
      // unless they are mid-ride; they cannot go online again until fixed.
      const { rows: online } = await tx.execute<{ driver_id: string }>(
        sql`SELECT driver_id FROM driver_availability WHERE is_online AND active_ride_id IS NULL`,
      );
      for (const { driver_id } of online) {
        const result = await this.eligibility.check(driver_id, tx);
        if (!result.eligible) {
          await tx.execute(
            sql`UPDATE driver_availability SET is_online = false WHERE driver_id = ${driver_id} AND active_ride_id IS NULL`,
          );
          await tx.execute(sql`DELETE FROM driver_locations WHERE driver_id = ${driver_id}`);
          await this.audit.record(
            {
              actorType: 'SYSTEM',
              action: 'driver.taken_offline_ineligible',
              entityType: 'driver',
              entityId: driver_id,
              metadata: { reasons: result.reasons },
            },
            tx,
          );
          report.driversTakenOffline++;
        }
      }
      this.logger.log({ report }, 'Maintenance complete');
      return report;
    });
  }
}
