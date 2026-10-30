import { ApiError, LocationFix } from '@saheli/api-client';
import { colors, createApiClient } from '@saheli/mobile-core';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { API_URL } from './config';

export const LOCATION_TASK = 'saheli-driver-location';

/** Same secure token store as the app, so the task sends fixes as the signed-in driver. */
const api = createApiClient({ app: 'DRIVER', apiUrl: API_URL });

export function toFix(pos: Location.LocationObject): LocationFix {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyM: pos.coords.accuracy ?? 999,
    headingDeg:
      pos.coords.heading !== null && pos.coords.heading >= 0 ? pos.coords.heading : undefined,
    speedMps: pos.coords.speed !== null && pos.coords.speed >= 0 ? pos.coords.speed : undefined,
    recordedAt: new Date(pos.timestamp).toISOString(),
  };
}

/** Errors that mean sharing should stop: signed out, offline on the server, or not allowed to drive. */
const STOP_CODES = new Set(['DRIVER_OFFLINE', 'NOT_ELIGIBLE_TO_DRIVE']);

// Runs in the background, including with the app closed, while updates are started.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    const locations = data?.locations ?? [];
    const latest = locations[locations.length - 1];
    if (error || !latest) return;
    try {
      await api.sendLocation(toFix(latest));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || STOP_CODES.has(err.code))) {
        await stopBackgroundUpdates();
      }
    }
  },
);

export async function startBackgroundUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    // Balance freshness against battery: every 5 s or 20 m, whichever comes first.
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,
    distanceInterval: 20,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    // Android keeps a visible notification while sharing, so the driver always knows.
    foregroundService: {
      notificationTitle: 'You are online',
      notificationBody: 'Sharing your location for ride requests. Go offline to stop.',
      notificationColor: colors.primary,
    },
  });
}

export async function stopBackgroundUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
}
