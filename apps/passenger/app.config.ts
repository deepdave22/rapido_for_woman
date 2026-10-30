import type { ConfigContext, ExpoConfig } from 'expo/config';

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
/** Optional HTTPS host for Android App Links / iOS Universal Links, e.g. go.example.in. */
const APP_LINK_HOST = process.env.APP_LINK_HOST;

if (release && !apiUrl?.startsWith('https://')) {
  throw new Error(`${variant} builds need EXPO_PUBLIC_API_URL set to an https URL`);
}
if (release && !EAS_PROJECT_ID) {
  throw new Error(
    `${variant} builds need the EAS project id (run "eas init", see MOBILE_RELEASE.md)`,
  );
}

const BERRY = '#7A1F5C';
/** Change together with PASSENGER_APP_ID in apps/api/src/health/app-links.controller.ts. */
const APP_ID = 'in.saheli.passenger';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Saheli',
  slug: 'saheli-passenger',
  owner: process.env.EXPO_OWNER,
  scheme: 'saheli',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  // Build numbers (versionCode / buildNumber) are kept by EAS and bumped on every store build.
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
    // Only standard HTTPS/TLS: exempt from export-compliance documentation.
    config: { usesNonExemptEncryption: false },
    associatedDomains: APP_LINK_HOST ? [`applinks:${APP_LINK_HOST}`] : undefined,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Saheli uses your location to set your pickup point and show nearby drivers. It is not tracked in the background.',
    },
  },
  android: {
    package: APP_ID,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/monochrome-icon.png',
      backgroundColor: BERRY,
    },
    // Only what the app uses; expo-notifications adds POST_NOTIFICATIONS itself.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    // Firebase config for push (FCM), supplied as an EAS file environment variable.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    // Required for map tiles on Android. Restrict this key to the app's package and SHA-1.
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } },
    intentFilters: APP_LINK_HOST
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [{ scheme: 'https', host: APP_LINK_HOST, pathPrefix: '/ride/' }],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : undefined,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Saheli uses your location to set your pickup point and show nearby drivers.',
        // The library links the "always" API, so iOS requires this text; the app never requests it.
        locationAlwaysAndWhenInUsePermission:
          'Saheli only uses your location while you are using the app, to set your pickup point.',
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
        backgroundColor: BERRY,
      },
    ],
  ],
  extra: {
    ...config.extra,
    appVariant: variant,
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
