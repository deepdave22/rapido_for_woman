import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Saheli Driver',
  slug: 'saheli-driver',
  scheme: 'saheli-driver',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'in.saheli.driver',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Your location is shared while you are online so we can send you nearby ride requests and show passengers where you are.',
    },
  },
  android: {
    package: 'in.saheli.driver',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Your location is shared while you are online so we can send you nearby ride requests.',
      },
    ],
  ],
};

export default config;
