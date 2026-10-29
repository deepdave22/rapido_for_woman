import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Saheli',
  slug: 'saheli-passenger',
  scheme: 'saheli',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'in.saheli.passenger',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Saheli uses your location to set your pickup point and show nearby drivers. It is not tracked in the background.',
    },
  },
  android: {
    package: 'in.saheli.passenger',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    // Required for map tiles on Android. Restrict this key to the app's package and SHA-1.
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Saheli uses your location to set your pickup point and show nearby drivers.',
      },
    ],
  ],
};

export default config;
