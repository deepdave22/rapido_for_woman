import type { ConfigContext, ExpoConfig } from 'expo/config';
import { ConfigPlugin, withInfoPlist } from 'expo/config-plugins';

/**
 * Build-time settings come from the environment. EAS sets them per build
 * profile (eas.json); locally they come from .env (see .env.example).
 */
const variant = process.env.APP_VARIANT ?? 'development';
const release = variant === 'preview' || variant === 'production';
const apiUrl = process.env.EXPO_PUBLIC_API_URL;

/**
 * The EAS project id printed by `eas init` (not a secret). Paste it here, or set
 * EAS_PROJECT_ID. Push notifications and store builds need it.
 */
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || '';

if (release && !apiUrl?.startsWith('https://')) {
  throw new Error(`${variant} builds need EXPO_PUBLIC_API_URL set to an https URL`);
}
if (release && !EAS_PROJECT_ID) {
  throw new Error(
    `${variant} builds need the EAS project id (run "eas init", see MOBILE_RELEASE.md)`,
  );
}

const SAFFRON = '#E8892B';
const BERRY = '#7A1F5C';

const LOCATION_ALWAYS =
  'While you are online, Saheli Driver shares your location so we can send you nearby ride requests and show your passenger where you are, including when the app is in the background. Location is not shared while you are offline.';
const LOCATION_IN_USE =
  'Your location is shared while you are online so we can send you nearby ride requests and show passengers where you are.';

/**
 * expo-task-manager declares the iOS "fetch" background mode, which this app
 * never uses; App Review rejects background modes an app does not need.
 */
const withoutBackgroundFetch: ConfigPlugin = (cfg) =>
  withInfoPlist(cfg, (c) => {
    const modes = c.modResults.UIBackgroundModes as string[] | undefined;
    if (modes) c.modResults.UIBackgroundModes = modes.filter((m) => m !== 'fetch');
    return c;
  });

export default ({ config }: ConfigContext): ExpoConfig =>
  withoutBackgroundFetch({
    ...config,
    name: 'Saheli Driver',
    slug: 'saheli-driver',
    owner: process.env.EXPO_OWNER,
    scheme: 'saheli-driver',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    icon: './assets/icon.png',
    // Build numbers (versionCode / buildNumber) are kept by EAS and bumped on every store build.
    ios: {
      bundleIdentifier: 'in.saheli.driver',
      supportsTablet: false,
      // Only standard HTTPS/TLS: exempt from export-compliance documentation.
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        NSLocationWhenInUseUsageDescription: LOCATION_IN_USE,
        NSLocationAlwaysAndWhenInUseUsageDescription: LOCATION_ALWAYS,
      },
    },
    android: {
      package: 'in.saheli.driver',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        monochromeImage: './assets/monochrome-icon.png',
        backgroundColor: SAFFRON,
      },
      // Background location runs as a visible foreground service while online.
      // expo-location adds FOREGROUND_SERVICE(_LOCATION); expo-notifications adds POST_NOTIFICATIONS.
      permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION'],
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
      // Firebase config for push (FCM), supplied as an EAS file environment variable.
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-location',
        {
          locationWhenInUsePermission: LOCATION_IN_USE,
          locationAlwaysAndWhenInUsePermission: LOCATION_ALWAYS,
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      [
        'expo-notifications',
        { icon: './assets/notification-icon.png', color: BERRY, defaultChannel: 'rides' },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 180,
          resizeMode: 'contain',
          backgroundColor: SAFFRON,
        },
      ],
    ],
    extra: {
      ...config.extra,
      appVariant: variant,
      ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    },
  });
