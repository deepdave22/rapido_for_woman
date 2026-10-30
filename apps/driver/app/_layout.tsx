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
import { OnboardingScreen } from '../src/OnboardingScreen';
// Registers the background location task at startup, as expo-task-manager requires.
import '../src/backgroundLocation';

function Gate() {
  const { state } = useAuth();
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'signedOut') {
    return (
      <PhoneSignIn
        appName="Saheli Driver"
        tagline="Drive with Saheli. For verified women drivers."
      />
    );
  }
  if (state.me.driver?.status !== 'APPROVED') return <OnboardingScreen />;
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
      <Stack.Screen name="index" options={{ title: 'Saheli Driver' }} />
      <Stack.Screen name="ride" options={{ title: 'Current ride', headerBackVisible: false }} />
      <Stack.Screen name="history" options={{ title: 'Trips' }} />
      <Stack.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider app="DRIVER" apiUrl={API_URL}>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
