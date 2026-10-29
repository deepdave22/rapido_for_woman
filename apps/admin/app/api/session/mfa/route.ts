import { NextResponse } from 'next/server';
import { apiUrl, csrfOk, forbiddenCsrf, setSessionCookies } from '@/lib/server-session';

/**
 * Step 2. `{ action: 'enroll', challengeToken }` returns a new TOTP secret;
 * `{ action: 'verify', challengeToken, code }` sets the session cookies.
 */
export async function POST(req: Request) {
  if (!csrfOk(req)) return forbiddenCsrf();
  const body = (await req.json()) as { action?: string; challengeToken?: string; code?: string };
  const path = body.action === 'enroll' ? '/v1/admin/auth/mfa/enroll' : '/v1/admin/auth/mfa/verify';
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: body.challengeToken, code: body.code }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok || body.action === 'enroll') return NextResponse.json(data, { status: res.status });
  const out = NextResponse.json({ ok: true });
  setSessionCookies(out, data);
  return out;
}
