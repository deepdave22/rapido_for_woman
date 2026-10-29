import { ApiError, SaheliClient } from '@saheli/api-client';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

export type SharingState = 'off' | 'starting' | 'on' | 'denied' | 'error';

/**
 * Sends GPS fixes while the driver is online, and stops as soon as she goes
 * offline. Foreground only for now: the app must stay open (see LAUNCH_BLOCKERS).
 */
export function useLocationSharing(
  api: SaheliClient,
  enabled: boolean,
): { state: SharingState; lastError: string | null } {
  const [state, setState] = useState<SharingState>('off');
  const [lastError, setLastError] = useState<string | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setState('off');
      return;
    }
    setState('starting');
    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') {
        setState('denied');
        return;
      }
      sub.current = await Location.watchPositionAsync(
        // Balance freshness against battery: every 5 s or 20 m, whichever comes first.
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 20 },
        (pos) => {
          api
            .sendLocation({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracyM: pos.coords.accuracy ?? 999,
              headingDeg:
                pos.coords.heading !== null && pos.coords.heading >= 0
                  ? pos.coords.heading
                  : undefined,
              speedMps:
                pos.coords.speed !== null && pos.coords.speed >= 0 ? pos.coords.speed : undefined,
              recordedAt: new Date(pos.timestamp).toISOString(),
            })
            .then(() => {
              setState('on');
              setLastError(null);
            })
            .catch((err: unknown) => {
              // Inaccurate or thinned fixes are expected; only surface real failures.
              if (err instanceof ApiError && err.code !== 'LOCATION_INACCURATE') {
                setLastError(err.message);
                if (err.code === 'NETWORK_ERROR') setState('error');
              }
            });
        },
      );
      if (cancelled) sub.current.remove();
    })();
    return () => {
      cancelled = true;
      sub.current?.remove();
      sub.current = null;
    };
  }, [api, enabled]);

  return { state, lastError };
}
