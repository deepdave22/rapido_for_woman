import { ExpoPushSender, PushMessage } from './push-sender';

const message = (n: number): PushMessage => ({
  to: `ExponentPushToken[device-${n}]`,
  title: 'Driver assigned',
  body: 'Your driver is on the way.',
  data: { path: '/ride/1' },
  channelId: 'rides',
});

function fakeFetch(respond: (batch: unknown[]) => Response) {
  const calls: { headers: Record<string, string>; batch: unknown[] }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const batch = JSON.parse(init.body as string) as unknown[];
    calls.push({ headers: init.headers as Record<string, string>, batch });
    return respond(batch);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ExpoPushSender', () => {
  it('maps tickets in order and flags devices that are gone', async () => {
    const { impl, calls } = fakeFetch(() =>
      json({
        data: [
          { status: 'ok', id: 'a' },
          { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        ],
      }),
    );
    const tickets = await new ExpoPushSender('secret', impl).send([1, 2, 3].map(message));
    expect(tickets).toEqual([
      { ok: true },
      { ok: false, error: 'DeviceNotRegistered', deviceGone: true },
      { ok: false, error: 'MessageTooBig', deviceGone: false },
    ]);
    expect(calls[0]!.headers.Authorization).toBe('Bearer secret');
    expect(calls[0]!.batch[0]).toMatchObject({ priority: 'high', channelId: 'rides' });
  });

  it('sends in batches of 100', async () => {
    const { impl, calls } = fakeFetch((batch) =>
      json({ data: batch.map(() => ({ status: 'ok' })) }),
    );
    const tickets = await new ExpoPushSender(undefined, impl).send(
      Array.from({ length: 250 }, (_, i) => message(i)),
    );
    expect(calls.map((c) => c.batch.length)).toEqual([100, 100, 50]);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(tickets.every((t) => t.ok)).toBe(true);
  });

  it('reports failure, never success, when the service rejects the request or is unreachable', async () => {
    const rejected = fakeFetch(() => json({ errors: [{ code: 'UNAUTHORIZED' }] }, 401));
    expect(await new ExpoPushSender('bad', rejected.impl).send([message(1)])).toEqual([
      { ok: false, error: 'PUSH_HTTP_401', deviceGone: false },
    ]);

    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await new ExpoPushSender(undefined, offline).send([message(1)])).toEqual([
      { ok: false, error: 'PUSH_NETWORK_ERROR', deviceGone: false },
    ]);
  });
});
