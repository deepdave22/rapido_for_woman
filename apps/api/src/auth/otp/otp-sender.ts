import { Logger } from '@nestjs/common';
import { maskIndianMobile } from '@saheli/domain';
import { Env } from '../../config/env';

export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpSender {
  /** Delivers a login code. Must throw if delivery was not accepted by the provider. */
  send(phoneE164: string, code: string): Promise<void>;
}

/** Development only: writes the code to the server log instead of sending an SMS. */
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('ConsoleOtpSender');

  async send(phoneE164: string, code: string): Promise<void> {
    this.logger.warn(`[DEV ONLY - no SMS sent] OTP for ${maskIndianMobile(phoneE164)}: ${code}`);
  }
}

/** Automated tests only: keeps codes in memory so tests can complete the login flow. */
export class InMemoryOtpSender implements OtpSender {
  private readonly codes = new Map<string, string>();

  async send(phoneE164: string, code: string): Promise<void> {
    this.codes.set(phoneE164, code);
  }

  lastCodeFor(phoneE164: string): string | undefined {
    return this.codes.get(phoneE164);
  }
}

export function createOtpSender(env: Env): OtpSender {
  switch (env.OTP_PROVIDER) {
    case 'console':
      return new ConsoleOtpSender();
    case 'memory':
      return new InMemoryOtpSender();
    case 'msg91':
      // Fail at startup rather than pretending to send. See docs/EXTERNAL_SERVICES.md.
      throw new Error('OTP_PROVIDER=msg91 is not implemented yet; no SMS provider is configured');
  }
}
