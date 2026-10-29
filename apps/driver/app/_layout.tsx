import { AuthProvider, colors, Loading, PhoneSignIn, useAuth } from '@saheli/mobile-core';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { API_URL } from '../src/config';
import { OnboardingScreen } from '../src/OnboardingScreen';

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
