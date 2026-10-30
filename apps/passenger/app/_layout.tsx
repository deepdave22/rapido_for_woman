import {
  AuthProvider,
  colors,
  Loading,
  PhoneSignIn,
  useAuth,
  usePushNotifications,
} from '@saheli/mobile-core';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { API_URL } from '../src/config';
import { TermsScreen } from '../src/TermsScreen';

function Gate() {
  const { state } = useAuth();
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'signedOut') {
    return <PhoneSignIn appName="Saheli" tagline="Rides with verified women drivers." />;
  }
  if (!state.me.passenger?.termsAccepted) return <TermsScreen />;
  return <SignedIn />;
}

function SignedIn() {
  const { api } = useAuth();
  usePushNotifications(api, (path) => router.push(path as never));
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Saheli' }} />
      <Stack.Screen name="ride/[id]" options={{ title: 'Your ride', headerBackVisible: false }} />
      <Stack.Screen name="history" options={{ title: 'Your rides' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
      <Stack.Screen name="safety" options={{ title: 'Safety' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider app="PASSENGER" apiUrl={API_URL}>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
