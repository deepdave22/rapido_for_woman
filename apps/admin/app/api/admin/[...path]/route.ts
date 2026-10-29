import { NextRequest, NextResponse } from 'next/server';
import {
  apiUrl,
  clearSessionCookies,
  csrfOk,
  forbiddenCsrf,
  readTokens,
  setSessionCookies,
} from '@/lib/server-session';

/** Forwards /api/admin/* to the API's /v1/admin/*, attaching the staff token from cookies. */
async function forward(
  req: NextRequest,
  path: string,
  accessToken: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: req.headers.get('accept') ?? 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const contentType = req.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  return fetch(apiUrl(`/v1/admin/${path}${req.nextUrl.search}`), {
    method: req.method,
    headers,
    body,
    cache: 'no-store',
  });
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (!csrfOk(req)) return forbiddenCsrf();
  const { path } = await ctx.params;
  const target = path.map(encodeURIComponent).join('/');
  const tokens = await readTokens();
  // Clone the body up front so a retry after refresh can resend it.
  const replay = req.clone() as NextRequest;
  let res = await forward(req, target, tokens.access);

  let refreshed: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresInSeconds: number;
  } | null = null;
  if (res.status === 401 && tokens.refresh) {
    const r = await fetch(apiUrl('/v1/admin/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
      cache: 'no-store',
    });
    if (r.ok) {
      refreshed = await r.json();
      res = await forward(replay, target, refreshed!.accessToken);
    }
  }

  const out = new NextResponse(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
      ...(res.headers.get('content-disposition')
        ? { 'Content-Disposition': res.headers.get('content-disposition')! }
        : {}),
    },
  });
  if (refreshed) setSessionCookies(out, refreshed);
  else if (res.status === 401) clearSessionCookies(out);
  return out;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
