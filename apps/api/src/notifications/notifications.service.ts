import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuthUser, ClientApp } from '../auth/auth.decorators';
import { DB, Database, Tx } from '../database/database.module';
import { notifications, pushTokens, sessions } from '../database/schema';
import { PUSH_SENDER, PushSender } from './push-sender';

export type DeliveryOutcome = 'SENT' | 'SKIPPED' | 'FAILED';

export interface OutboundMessage {
  userId?: string | null;
  recipientPhoneE164?: string | null;
  channel: 'SMS' | 'IN_APP';
  template: string;
  payload: Record<string, unknown>;
}

export interface PushNotice {
  userId: string;
  /** Only devices signed in to this app receive it (a driver can also be a passenger). */
  app: ClientApp;
  template: string;
  /** Shown on the lock screen: keep it free of names, numbers and addresses. */
  title: string;
  body: string;
  /** In-app route opened when the notification is tapped. */
  path: string;
}

export type DeliveryResult = { id: string; outcome: DeliveryOutcome; reason?: string };

/**
 * Records every outbound notification and attempts delivery. No SMS provider
 * is integrated yet, so SMS is recorded as SKIPPED with the reason; callers
 * report that state to users instead of claiming success. Push goes through
 * the configured push sender, or is recorded as SKIPPED when there is none.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PUSH_SENDER) private readonly pushSender: PushSender | null,
  ) {}

  async send(message: OutboundMessage, tx?: Tx): Promise<DeliveryResult> {
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
    return this.skip(row!.id, message.template, 'SMS_PROVIDER_NOT_CONFIGURED', q);
  }

  /**
   * Sends a push to every device the user is signed in on in that app. Makes
   * a network call, so never call it inside a database transaction.
   * SENT means the push service accepted it; delivery to the phone is not confirmed.
   */
  async push(notice: PushNotice): Promise<DeliveryResult> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        userId: notice.userId,
        channel: 'PUSH',
        template: notice.template,
        payload: { title: notice.title, body: notice.body, path: notice.path },
      })
      .returning({ id: notifications.id });
    const id = row!.id;
    if (!this.pushSender) return this.skip(id, notice.template, 'PUSH_PROVIDER_NOT_CONFIGURED');

    const tokens = await this.activeTokens(notice.userId, notice.app);
    if (!tokens.length) return this.skip(id, notice.template, 'NO_DEVICE_REGISTERED');

    const tickets = await this.pushSender.send(
      tokens.map((to) => ({
        to,
        title: notice.title,
        body: notice.body,
        data: { path: notice.path },
        channelId: 'rides' as const,
      })),
    );
    const gone = tokens.filter((_, i) => {
      const t = tickets[i];
      return t && !t.ok && t.deviceGone;
    });
    if (gone.length) await this.db.delete(pushTokens).where(inArray(pushTokens.token, gone));

    const delivered = tickets.some((t) => t.ok);
    const failure = tickets.find((t) => !t.ok);
    const reason = failure && !failure.ok ? failure.error : undefined;
    await this.db
      .update(notifications)
      .set(
        delivered
          ? { status: 'SENT', sentAt: new Date(), attempts: 1 }
          : { status: 'FAILED', attempts: 1, lastError: reason ?? null },
      )
      .where(eq(notifications.id, id));
    if (!delivered) {
      this.logger.warn({ notificationId: id, template: notice.template }, 'Push not accepted');
      return { id, outcome: 'FAILED', reason };
    }
    return { id, outcome: 'SENT' };
  }

  /** Registers this device's push token, moving it over if another account had it. */
  async registerToken(user: AuthUser, token: string, platform: 'ANDROID' | 'IOS'): Promise<void> {
    const owner = {
      userId: user.userId,
      sessionFamilyId: user.sessionId,
      app: user.app,
      platform,
    };
    await this.db
      .insert(pushTokens)
      .values({ ...owner, token })
      .onConflictDoUpdate({ target: pushTokens.token, set: { ...owner, updatedAt: new Date() } });
  }

  async removeToken(user: AuthUser, token: string): Promise<void> {
    await this.db
      .delete(pushTokens)
      .where(and(eq(pushTokens.userId, user.userId), eq(pushTokens.token, token)));
  }

  /** Called when a sign-in ends, so the device stops receiving this account's pushes. */
  async removeTokensForSession(userId: string, sessionFamilyId: string): Promise<void> {
    await this.db
      .delete(pushTokens)
      .where(and(eq(pushTokens.userId, userId), eq(pushTokens.sessionFamilyId, sessionFamilyId)));
  }

  /** Tokens whose sign-in is still live (not revoked, not expired). */
  private async activeTokens(userId: string, app: ClientApp): Promise<string[]> {
    const rows = await this.db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(
        and(
          eq(pushTokens.userId, userId),
          eq(pushTokens.app, app),
          sql`EXISTS (SELECT 1 FROM ${sessions}
            WHERE ${sessions.familyId} = ${pushTokens.sessionFamilyId}
              AND ${sessions.revokedAt} IS NULL
              AND ${sessions.expiresAt} > now())`,
        ),
      );
    return rows.map((r) => r.token);
  }

  private async skip(
    id: string,
    template: string,
    reason: string,
    q: Database | Tx = this.db,
  ): Promise<DeliveryResult> {
    await q
      .update(notifications)
      .set({ status: 'SKIPPED', lastError: reason, attempts: 1 })
      .where(eq(notifications.id, id));
    this.logger.warn({ notificationId: id, template }, `Not delivered: ${reason}`);
    return { id, outcome: 'SKIPPED', reason };
  }
}
