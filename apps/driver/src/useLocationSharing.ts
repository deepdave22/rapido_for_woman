import { ApiError, SaheliClient } from '@saheli/api-client';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { startBackgroundUpdates, stopBackgroundUpdates, toFix } from './backgroundLocation';

/**
 * `background`: shared even with the screen off or the app closed.
 * `foreground`: background permission was refused, so only while the app is open.
 */
export type SharingState = 'off' | 'starting' | 'background' | 'foreground' | 'denied' | 'error';

// Several screens share one background task. Count users and stop a moment after
// the last one leaves, so moving from the home screen to the ride screen does not
// interrupt sharing. Start and stop calls run one at a time.
let holders = 0;
let queue: Promise<void> = Promise.resolve();
const serial = (fn: () => Promise<void>): Promise<void> => {
  const run = queue.then(fn);
  queue = run.catch(() => undefined);
  return run;
};

/**
 * Google Play requires this disclosure, in the app, before the system prompt for
 * background location. Shown only while the permission can still be asked for.
 */
function discloseBackgroundLocation(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Share location in the background?',
      'Saheli Driver collects your location to send you nearby ride requests and to show your passenger where you are, even when the app is closed or not in use, while you are online. Location is not collected when you are offline. On the next screen, choose "Allow all the time".',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function backgroundAllowed(): Promise<boolean> {
  const current = await Location.getBackgroundPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain || !(await discloseBackgroundLocation())) return false;
  return (await Location.requestBackgroundPermissionsAsync()).granted;
}

/**
 * Sends GPS fixes while the driver is online or on a ride, and stops as soon as
 * she goes offline. Uses background updates when she allows it, falling back
 * to foreground-only sharing otherwise.
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
    let holding = false;
    if (!enabled) {
      setState('off');
      // Also stops a task left running from a previous launch.
      if (holders === 0) serial(stopBackgroundUpdates).catch(() => undefined);
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
      if (await backgroundAllowed().catch(() => false)) {
        if (cancelled) return;
        holding = true;
        holders++;
        try {
          await serial(startBackgroundUpdates);
          if (!cancelled) setState('background');
          return;
        } catch {
          // Fall through to foreground sharing.
        }
      }
      if (cancelled) return;
      sub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 20 },
        (pos) => {
          api
            .sendLocation(toFix(pos))
            .then(() => {
              setState('foreground');
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
      if (holding) {
        holders--;
        setTimeout(() => {
          if (holders === 0) serial(stopBackgroundUpdates).catch(() => undefined);
        }, 3000);
      }
    };
  }, [api, enabled]);

  return { state, lastError };
}
