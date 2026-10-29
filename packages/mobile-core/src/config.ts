/**
 * API base URL, from EXPO_PUBLIC_API_URL at build time. Release builds must
 * point at an https URL; plain http is only accepted for local development.
 */
export function apiUrlFromEnv(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) {
    throw new Error('EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env in the app folder.');
  }
  if (!__DEV__ && !url.startsWith('https://')) {
    throw new Error('Release builds must use an https API URL');
  }
  return url;
}
