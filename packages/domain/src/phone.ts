import { DomainError } from './errors';

/**
 * Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX). Accepts common
 * input forms: "98765 43210", "098765-43210", "+91 98765 43210", "919876543210".
 * Indian mobile numbers are 10 digits starting with 6-9.
 */
export function normalizeIndianMobile(input: string): string {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) {
    if (!digits.startsWith('+91')) {
      throw new DomainError(
        'UNSUPPORTED_COUNTRY',
        'Only Indian (+91) mobile numbers are supported',
      );
    }
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (!/^[6-9]\d{9}$/.test(digits)) {
    throw new DomainError('INVALID_PHONE', 'Enter a valid 10-digit Indian mobile number');
  }
  return `+91${digits}`;
}

/** "+91 98765 43210" for display. */
export function formatIndianMobile(e164: string): string {
  const n = normalizeIndianMobile(e164).slice(3);
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

/** "+91 ••••• •3210" — for screens and logs that must not show the full number. */
export function maskIndianMobile(e164: string): string {
  const n = normalizeIndianMobile(e164).slice(3);
  return `+91 ••••• •${n.slice(6)}`;
}
