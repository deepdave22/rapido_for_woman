import { describe, expect, it, vi } from 'vitest';
import { ApiError, SaheliClient, TokenStore } from './client';
import { formatDistance, formatDuration } from './format';
import type { Tokens } from './types';

function memoryStore(initial: Tokens | null = null): TokenStore & { value: Tokens | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (t: Tokens) => {
      store.value = t;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(
  fetchImpl: typeof fetch,
  tokens = memoryStore({ accessToken: 'a1', refreshToken: 'r1' }),
) {
  const onSignedOut = vi.fn();
  let n = 0;
  const c = new SaheliClient({
    baseUrl: 'https://api.test/',
    app: 'PASSENGER',
    tokens,
    newIdempotencyKey: () => `key-${++n}`,
    onSignedOut,
    fetch: fetchImpl,
  });
  return { c, tokens, onSignedOut };
}

describe('SaheliClient', () => {
  it('sends the bearer token and parses JSON', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 'u1' }));
    const { c } = client(fetchMock as unknown as typeof fetch);
    await expect(c.me()).resolves.toEqual({ id: 'u1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer a1');
  });

  it('turns error bodies into ApiError with the server code', async () => {
    const { c } = client((async () =>
      json(409, {
        error: { code: 'ACTIVE_RIDE_EXISTS', message: 'busy', requestId: 'r' },
      })) as unknown as typeof fetch);
    const err = await c.book('q1', 'CASH').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'ACTIVE_RIDE_EXISTS', requestId: 'r' });
  });

  it('adds an Idempotency-Key to bookings, reusing one passed for a retry', async () => {
    const fetchMock = vi.fn(async () => json(201, { id: 'ride' }));
    const { c } = client(fetchMock as unknown as typeof fetch);
    await c.book('q1', 'CASH');
    await c.book('q1', 'CASH', 'retry-key-123');
    const keys = fetchMock.mock.calls.map(
      (call) =>
        ((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)[
          'Idempotency-Key'
        ],
    );
    expect(keys).toEqual(['key-1', 'retry-key-123']);
  });

  it('refreshes once for concurrent expired requests, then retries them', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 'a2', refreshToken: 'r2' });
      }
      return auth === 'Bearer a2'
        ? json(200, { ok: true })
        : json(401, { error: { code: 'ACCESS_TOKEN_INVALID', message: 'expired' } });
    });
    const { c, tokens } = client(fetchMock as unknown as typeof fetch);
    const results = await Promise.all([c.me(), c.activeRide().catch(() => 'x'), c.sessions()]);
    expect(refreshCalls).toBe(1);
    expect(results[0]).toEqual({ ok: true });
    expect(tokens.value).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('signs out when the refresh token is rejected', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/refresh')
        ? json(401, { error: { code: 'REFRESH_TOKEN_REUSED', message: 'no' } })
        : json(401, { error: { code: 'ACCESS_TOKEN_INVALID', message: 'expired' } }),
    );
    const { c, tokens, onSignedOut } = client(fetchMock as unknown as typeof fetch);
    await expect(c.me()).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID' });
    expect(tokens.value).toBeNull();
    expect(onSignedOut).toHaveBeenCalled();
  });

  it('reports network failures with a stable code', async () => {
    const { c } = client((async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch);
    await expect(c.me()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('unwraps nullable endpoints', async () => {
    const { c } = client((async () => json(200, { offer: null })) as unknown as typeof fetch);
    await expect(c.currentOffer()).resolves.toBeNull();
  });
});

describe('formatting', () => {
  it('clears stored tokens after deleting the account, but keeps them if deletion fails', async () => {
    const ok = client((async () => json(200, { deleted: true })) as unknown as typeof fetch);
    await ok.c.deleteAccount();
    expect(ok.tokens.value).toBeNull();

    const refused = client((async () =>
      json(409, {
        error: { code: 'ACTIVE_RIDE', message: 'Finish your ride first' },
      })) as unknown as typeof fetch);
    await expect(refused.c.deleteAccount()).rejects.toMatchObject({ code: 'ACTIVE_RIDE' });
    expect(refused.tokens.value).not.toBeNull();
  });

  it('formats distance and duration', () => {
    expect(formatDistance(4890)).toBe('4.9 km');
    expect(formatDistance(812)).toBe('810 m');
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(65 * 60)).toBe('1 h 5 min');
  });
});
