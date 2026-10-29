import { NextResponse } from 'next/server';
import {
  apiUrl,
  clearSessionCookies,
  csrfOk,
  forbiddenCsrf,
  readTokens,
} from '@/lib/server-session';

export async function POST(req: Request) {
  if (!csrfOk(req)) return forbiddenCsrf();
  const { access } = await readTokens();
  if (access) {
    await fetch(apiUrl('/v1/admin/auth/logout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }
  const out = NextResponse.json({ ok: true });
  clearSessionCookies(out);
  return out;
}
