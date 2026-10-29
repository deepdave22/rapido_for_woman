import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Staff tokens live only in httpOnly, SameSite=strict cookies set by this
 * server. Browser JavaScript never sees them, so an XSS bug cannot steal a
 * session token.
 */
export const ACCESS_COOKIE = 'saheli_staff_at';
export const REFRESH_COOKIE = 'saheli_staff_rt';
export const CSRF_HEADER = 'x-saheli-csrf';

export function apiUrl(path: string): string {
  const base = process.env.SAHELI_API_URL;
  if (!base) throw new Error('SAHELI_API_URL is not set');
  return `${base.replace(/\/$/, '')}${path}`;
}

const secure = process.env.NODE_ENV === 'production';

export function setSessionCookies(
  res: NextResponse,
  tokens: { accessToken: string; refreshToken: string; accessTokenExpiresInSeconds: number },
): void {
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: tokens.accessTokenExpiresInSeconds,
  });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api',
    maxAge: 12 * 60 * 60,
  });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { path: '/api', maxAge: 0 });
}

export async function readTokens(): Promise<{ access?: string; refresh?: string }> {
  const jar = await cookies();
  return { access: jar.get(ACCESS_COOKIE)?.value, refresh: jar.get(REFRESH_COOKIE)?.value };
}

/**
 * Cross-site requests cannot add custom headers without a CORS preflight,
 * which this app never allows; together with SameSite=strict this blocks CSRF.
 */
export function csrfOk(req: Request): boolean {
  return req.method === 'GET' || req.method === 'HEAD' || req.headers.get(CSRF_HEADER) === '1';
}

export function forbiddenCsrf(): NextResponse {
  return NextResponse.json(
    { error: { code: 'CSRF_CHECK_FAILED', message: 'Request blocked' } },
    { status: 403 },
  );
}
