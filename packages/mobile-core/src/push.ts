import { SaheliClient } from '@saheli/api-client';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { colors } from './theme';

/** Must match the channelId the API sends (apps/api/src/notifications/push-sender.ts). */
const RIDES_CHANNEL = 'rides';

export type PushState =
  | 'pending'
  | 'on'
  | 'denied'
  /** Simulator, Expo Go, or a build without an EAS project id. */
  | 'unavailable'
  | 'error';

// Show ride updates even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? undefined;
}

function pathFrom(response: Notifications.NotificationResponse | null): string | null {
  const path = response?.notification.request.content.data?.path;
  // Only in-app routes: never follow a URL from a notification payload.
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : null;
}

/**
 * Registers this device for ride notifications while signed in, and opens the
 * route a notification points at when it is tapped (including from a cold start).
 * The server forgets the device when the session ends, so sign-out needs no extra call.
 */
export function usePushNotifications(api: SaheliClient, onOpen: (path: string) => void): PushState {
  const [state, setState] = useState<PushState>('pending');
  const open = useRef(onOpen);
  open.current = onOpen;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync(RIDES_CHANNEL, {
            name: 'Ride updates',
            description: 'Ride requests, driver arrival and trip changes',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: colors.primary,
          });
        }
        const id = projectId();
        if (!Device.isDevice || !id) {
          if (!cancelled) setState('unavailable');
          return;
        }
        let perm = await Notifications.getPermissionsAsync();
        if (perm.status !== 'granted' && perm.canAskAgain) {
          perm = await Notifications.requestPermissionsAsync();
        }
        if (perm.status !== 'granted') {
          if (!cancelled) setState('denied');
          return;
        }
        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
        await api.registerPushToken(token, Platform.OS === 'ios' ? 'IOS' : 'ANDROID');
        if (!cancelled) setState('on');
      } catch {
        // Expo Go cannot receive remote pushes; development builds and store builds can.
        if (!cancelled) setState('error');
      }
    })();

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const path = pathFrom(response);
      if (path && !cancelled) open.current(path);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const path = pathFrom(response);
      if (path) open.current(path);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [api]);

  return state;
}
