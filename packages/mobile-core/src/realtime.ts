import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './auth';

import type { Offer } from '@saheli/api-client';

export interface RealtimePayloads {
  'ride.updated': { rideId: string; status: string; version: number };
  'offer.created': Offer;
  'offer.withdrawn': { offerId?: string; rideId?: string; reason: string };
  'driver.location': {
    rideId: string;
    lat: number;
    lng: number;
    headingDeg: number | null;
    recordedAt: string;
  };
}

type Handlers = { [K in keyof RealtimePayloads]?: (payload: RealtimePayloads[K]) => void };
const EVENTS = ['ride.updated', 'offer.created', 'offer.withdrawn', 'driver.location'] as const;

/**
 * Subscribes to server pushes while signed in. Sockets only signal changes:
 * on (re)connect and when the app returns to the foreground, `onResync` should
 * refetch state over REST, because pushes sent while disconnected are lost.
 */
export function useRealtime(apiUrl: string, handlers: Handlers, onResync: () => void): void {
  const { state, api } = useAuth();
  const handlersRef = useRef(handlers);
  const resyncRef = useRef(onResync);
  handlersRef.current = handlers;
  resyncRef.current = onResync;
  const signedIn = state.status === 'signedIn';

  useEffect(() => {
    if (!signedIn) return;
    let socket: Socket | null = null;
    let cancelled = false;

    void (async () => {
      const token = await api.accessToken();
      if (!token || cancelled) return;
      socket = io(`${apiUrl.replace(/\/$/, '')}/realtime`, {
        transports: ['websocket'],
        // Read the latest token on every (re)connect attempt; it rotates.
        auth: (cb) => {
          void api.accessToken().then((t) => cb({ token: t }));
        },
        reconnectionDelayMax: 10_000,
      });
      socket.on('ready', () => resyncRef.current());
      for (const event of EVENTS) {
        socket.on(event, (payload: unknown) => {
          const handler = handlersRef.current[event] as ((p: unknown) => void) | undefined;
          handler?.(payload);
        });
      }
    })();

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') resyncRef.current();
    });
    return () => {
      cancelled = true;
      sub.remove();
      socket?.disconnect();
    };
  }, [signedIn, api, apiUrl]);
}
