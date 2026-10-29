import { NextResponse } from 'next/server';
import { apiUrl, csrfOk, forbiddenCsrf } from '@/lib/server-session';

/** Step 1: email + password. Returns the MFA challenge; no session yet. */
export async function POST(req: Request) {
  if (!csrfOk(req)) return forbiddenCsrf();
  const res = await fetch(apiUrl('/v1/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await req.text(),
    cache: 'no-store',
  });
  return new NextResponse(res.body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
