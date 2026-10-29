import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { AppError } from '../common/errors';
import { safeEqual } from '../common/hashing';
import { Env } from '../config/env';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface ProviderOrder {
  orderId: string;
}

/** Normalised webhook event. Amounts are paise. */
export type WebhookEvent =
  | {
      kind: 'payment.captured';
      eventId: string;
      orderId: string;
      paymentId: string;
      amountPaise: number;
    }
  | { kind: 'payment.failed'; eventId: string; orderId: string; paymentId: string; reason: string }
  | {
      kind: 'refund.processed';
      eventId: string;
      refundId: string;
      paymentId: string;
      amountPaise: number;
    }
  | { kind: 'ignored'; eventId: string; type: string };

export interface PaymentProvider {
  readonly name: 'sandbox' | 'razorpay';
  /** Public identifier the app needs to open checkout (Razorpay key_id); never a secret. */
  readonly publicKey: string | null;
  createOrder(amountPaise: number, receipt: string): Promise<ProviderOrder>;
  /** Throws unless the signature matches the exact raw body. */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookEvent;
  refund(paymentId: string, amountPaise: number, receipt: string): Promise<{ refundId: string }>;
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function hmacHex(secret: string, body: Buffer | string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

interface RazorpayWebhook {
  event: string;
  payload?: {
    payment?: {
      entity?: { id: string; order_id: string; amount: number; error_description?: string };
    };
    refund?: { entity?: { id: string; payment_id: string; amount: number } };
  };
}

function normalise(body: RazorpayWebhook, eventId: string): WebhookEvent {
  const payment = body.payload?.payment?.entity;
  const refund = body.payload?.refund?.entity;
  if (body.event === 'payment.captured' && payment) {
    return {
      kind: 'payment.captured',
      eventId,
      orderId: payment.order_id,
      paymentId: payment.id,
      amountPaise: payment.amount,
    };
  }
  if (body.event === 'payment.failed' && payment) {
    return {
      kind: 'payment.failed',
      eventId,
      orderId: payment.order_id,
      paymentId: payment.id,
      reason: payment.error_description ?? 'Payment failed',
    };
  }
  if (body.event === 'refund.processed' && refund) {
    return {
      kind: 'refund.processed',
      eventId,
      refundId: refund.id,
      paymentId: refund.payment_id,
      amountPaise: refund.amount,
    };
  }
  return { kind: 'ignored', eventId, type: body.event };
}

function verifySignature(secret: string, rawBody: Buffer, signature: string | undefined): void {
  if (!signature || !safeEqual(hmacHex(secret, rawBody), signature)) {
    throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature');
  }
}

/**
 * Development and tests only. Creates fake orders and accepts webhooks in
 * Razorpay's format signed with SANDBOX_WEBHOOK_SECRET. No money moves.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'sandbox' as const;
  readonly publicKey = null;

  constructor(private readonly webhookSecret: string) {}

  async createOrder(): Promise<ProviderOrder> {
    return { orderId: `sandbox_order_${randomUUID()}` };
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookEvent {
    verifySignature(this.webhookSecret, rawBody, header(headers, 'x-razorpay-signature'));
    const eventId = header(headers, 'x-razorpay-event-id');
    if (!eventId) throw new AppError(400, 'WEBHOOK_EVENT_ID_MISSING', 'Missing event id');
    return normalise(JSON.parse(rawBody.toString('utf8')) as RazorpayWebhook, eventId);
  }

  async refund(): Promise<{ refundId: string }> {
    return { refundId: `sandbox_refund_${randomUUID()}` };
  }

  /** Test helper: signs a body the way the gateway would. */
  static sign(secret: string, body: string): string {
    return hmacHex(secret, body);
  }
}

/** Razorpay Orders, Refunds and webhook signature verification. */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  readonly publicKey: string;
  private readonly logger = new Logger('Razorpay');
  private readonly auth: string;

  constructor(
    private readonly keyId: string,
    keySecret: string,
    private readonly webhookSecret: string,
  ) {
    this.auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
    this.publicKey = keyId;
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1${path}`, {
        method: 'POST',
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error({ err, path }, 'Razorpay request failed');
      throw new AppError(
        503,
        'PAYMENT_GATEWAY_UNAVAILABLE',
        'Payments are unavailable. Please try again',
      );
    }
    if (!res.ok) {
      this.logger.error({ status: res.status, path }, 'Razorpay returned an error');
      throw new AppError(
        502,
        'PAYMENT_GATEWAY_ERROR',
        'The payment could not be started. Please try again',
      );
    }
    return (await res.json()) as T;
  }

  async createOrder(amountPaise: number, receipt: string): Promise<ProviderOrder> {
    const order = await this.call<{ id: string }>('/orders', {
      amount: amountPaise,
      currency: 'INR',
      receipt: receipt.slice(0, 40),
    });
    return { orderId: order.id };
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookEvent {
    verifySignature(this.webhookSecret, rawBody, header(headers, 'x-razorpay-signature'));
    const eventId = header(headers, 'x-razorpay-event-id');
    if (!eventId) throw new AppError(400, 'WEBHOOK_EVENT_ID_MISSING', 'Missing event id');
    return normalise(JSON.parse(rawBody.toString('utf8')) as RazorpayWebhook, eventId);
  }

  async refund(
    paymentId: string,
    amountPaise: number,
    receipt: string,
  ): Promise<{ refundId: string }> {
    const refund = await this.call<{ id: string }>(
      `/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        amount: amountPaise,
        receipt: receipt.slice(0, 40),
      },
    );
    return { refundId: refund.id };
  }
}

export function createPaymentProvider(env: Env): PaymentProvider {
  return env.PAYMENT_PROVIDER === 'razorpay'
    ? new RazorpayProvider(
        env.RAZORPAY_KEY_ID!,
        env.RAZORPAY_KEY_SECRET!,
        env.RAZORPAY_WEBHOOK_SECRET!,
      )
    : new SandboxPaymentProvider(env.SANDBOX_WEBHOOK_SECRET);
}
