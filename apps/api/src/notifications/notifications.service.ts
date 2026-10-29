import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Database, Tx } from '../database/database.module';
import { notifications } from '../database/schema';

export type DeliveryOutcome = 'SENT' | 'SKIPPED' | 'FAILED';

export interface OutboundMessage {
  userId?: string | null;
  recipientPhoneE164?: string | null;
  channel: 'PUSH' | 'SMS' | 'IN_APP';
  template: string;
  payload: Record<string, unknown>;
}

/**
 * Records every outbound notification and attempts delivery. No SMS or push
 * provider is integrated yet, so SMS and PUSH are recorded as SKIPPED with
 * the reason; callers report that state to users instead of claiming success.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(@Inject(DB) private readonly db: Database) {}

  async send(
    message: OutboundMessage,
    tx?: Tx,
  ): Promise<{ id: string; outcome: DeliveryOutcome; reason?: string }> {
    const q = tx ?? this.db;
    const [row] = await q
      .insert(notifications)
      .values({
        userId: message.userId ?? null,
        recipientPhoneE164: message.recipientPhoneE164 ?? null,
        channel: message.channel,
        template: message.template,
        payload: message.payload,
      })
      .returning({ id: notifications.id });

    if (message.channel === 'IN_APP') {
      await q
        .update(notifications)
        .set({ status: 'SENT', sentAt: new Date() })
        .where(eq(notifications.id, row!.id));
      return { id: row!.id, outcome: 'SENT' };
    }
    const reason =
      message.channel === 'SMS' ? 'SMS_PROVIDER_NOT_CONFIGURED' : 'PUSH_PROVIDER_NOT_CONFIGURED';
    await q
      .update(notifications)
      .set({ status: 'SKIPPED', lastError: reason, attempts: 1 })
      .where(eq(notifications.id, row!.id));
    this.logger.warn(
      { notificationId: row!.id, template: message.template },
      `Not delivered: ${reason}`,
    );
    return { id: row!.id, outcome: 'SKIPPED', reason };
  }
}
