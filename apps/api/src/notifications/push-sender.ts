import { Logger } from '@nestjs/common';
import { Env } from '../config/env';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Delivered to the app; `path` is the in-app route to open when tapped. */
  data: Record<string, unknown>;
  /** Android notification channel created by the app. */
  channelId: 'rides';
}

/** One ticket per message, in order. `ok` means the push service accepted it, not that it arrived. */
export type PushTicket = { ok: true } | { ok: false; error: string; deviceGone: boolean };

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

/** Expo push service, which relays to FCM (Android) and APNs (iOS) with the project's credentials. */
export class ExpoPushSender implements PushSender {
  private readonly logger = new Logger('ExpoPushSender');

  constructor(
    private readonly accessToken: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      tickets.push(...(await this.sendBatch(messages.slice(i, i + EXPO_BATCH_SIZE))));
    }
    return tickets;
  }

  private async sendBatch(batch: PushMessage[]): Promise<PushTicket[]> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    let res: Response;
    try {
      res = await this.fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default', priority: 'high' }))),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.warn({ err }, 'Expo push request failed');
      return batch.map(() => ({ ok: false, error: 'PUSH_NETWORK_ERROR', deviceGone: false }));
    }
    const body = (await res.json().catch(() => null)) as {
      data?: { status: 'ok' | 'error'; details?: { error?: string } }[];
    } | null;
    if (!res.ok || !Array.isArray(body?.data) || body.data.length !== batch.length) {
      this.logger.warn({ status: res.status }, 'Expo push request rejected');
      return batch.map(() => ({ ok: false, error: `PUSH_HTTP_${res.status}`, deviceGone: false }));
    }
    return body.data.map((t) =>
      t.status === 'ok'
        ? { ok: true as const }
        : {
            ok: false as const,
            error: t.details?.error ?? 'PUSH_REJECTED',
            deviceGone: t.details?.error === 'DeviceNotRegistered',
          },
    );
  }
}

/** Automated tests only: records messages instead of sending them. */
export class InMemoryPushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  readonly goneTokens = new Set<string>();

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    return messages.map((m) => {
      if (this.goneTokens.has(m.to)) {
        return { ok: false, error: 'DeviceNotRegistered', deviceGone: true };
      }
      this.sent.push(m);
      return { ok: true };
    });
  }
}

/** `null` means no provider: pushes are recorded as SKIPPED. */
export function createPushSender(env: Env): PushSender | null {
  switch (env.PUSH_PROVIDER) {
    case 'none':
      return null;
    case 'expo':
      return new ExpoPushSender(env.EXPO_ACCESS_TOKEN);
    case 'memory':
      return new InMemoryPushSender();
  }
}
