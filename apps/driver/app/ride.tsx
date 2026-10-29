import { ApiError, DriverRide, errorMessage, formatInr } from '@saheli/api-client';
import {
  Banner,
  Button,
  Card,
  Loading,
  Muted,
  Screen,
  space,
  TextField,
  type,
  useAuth,
  useRealtime,
} from '@saheli/mobile-core';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Text } from 'react-native';
import { API_URL } from '../src/config';
import { useLocationSharing } from '../src/useLocationSharing';

const DRIVER_CANCEL_REASONS = [
  'Vehicle problem',
  'Cannot reach pickup',
  'Passenger asked me to cancel',
  'Safety concern',
];

function navigateTo(lat: number, lng: number) {
  void Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  );
}

export default function DriverRideScreen() {
  const { api } = useAuth();
  const [ride, setRide] = useState<DriverRide | null>(null);
  const [completed, setCompleted] = useState<DriverRide | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep sharing location for the passenger's live tracking during the ride.
  useLocationSharing(api, ride !== null);

  const load = useCallback(async () => {
    try {
      const r = await api.driverActiveRide();
      if (!r && !completed) {
        router.replace('/');
        return;
      }
      setRide(r);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, completed]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(API_URL, { 'ride.updated': () => void load() }, () => void load());

  async function act(fn: () => Promise<DriverRide>) {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next.status === 'COMPLETED') setCompleted(next);
      setRide(next.status === 'COMPLETED' ? null : next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PIN_INCORRECT') {
        const left = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
        setError(
          `That PIN is not correct. ${left ?? 0} attempts left. Ask the passenger to read it from her app.`,
        );
      } else {
        setError(errorMessage(err));
      }
      void load();
    } finally {
      setBusy(false);
    }
  }

  function confirmCancel() {
    if (!ride) return;
    Alert.alert(
      'Cancel this ride?',
      'The passenger will be matched with another driver. Frequent cancellations affect your account.',
      [
        ...DRIVER_CANCEL_REASONS.map((reason) => ({
          text: reason,
          onPress: async () => {
            setBusy(true);
            try {
              await api.driverCancel(ride.id, reason);
              router.replace('/');
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          },
        })),
        { text: 'Keep ride', style: 'cancel' as const },
      ],
    );
  }

  if (completed && !ride) {
    return (
      <Screen>
        <Text style={type.title}>Trip complete</Text>
        <Card style={{ marginTop: space.md }}>
          <Text style={type.heading}>Collect {formatInr(completed.finalTotalPaise ?? 0)}</Text>
          <Muted>
            {completed.paymentMethod === 'CASH'
              ? 'The passenger pays this amount in cash.'
              : 'The passenger pays online. Do not accept cash.'}
          </Muted>
        </Card>
        <Button title="Back to home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  if (!ride)
    return error ? (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );

  const beforePickup = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(
    ride.status,
  );

  return (
    <Screen>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Text style={type.title}>{ride.passenger.firstName ?? 'Passenger'}</Text>
      <Muted>
        {ride.categoryCode} · {ride.paymentMethod === 'CASH' ? 'Cash' : 'Online payment'}
      </Muted>

      <Card style={{ marginTop: space.md }}>
        <Muted>Pickup</Muted>
        <Text style={type.body}>{ride.pickup.address}</Text>
        <Muted>Drop</Muted>
        <Text style={type.body}>{ride.dropoff.address}</Text>
        <Button
          title={beforePickup ? 'Navigate to pickup' : 'Navigate to drop'}
          variant="secondary"
          onPress={() =>
            beforePickup
              ? navigateTo(ride.pickup.lat, ride.pickup.lng)
              : navigateTo(ride.dropoff.lat, ride.dropoff.lng)
          }
        />
      </Card>

      {ride.status === 'DRIVER_ASSIGNED' ? (
        <Button
          title="I'm on my way"
          onPress={() => act(() => api.driverRideAction(ride.id, 'arriving'))}
          loading={busy}
        />
      ) : null}
      {ride.status === 'DRIVER_ASSIGNED' || ride.status === 'DRIVER_ARRIVING' ? (
        <Button
          title="I've arrived at pickup"
          onPress={() => act(() => api.driverRideAction(ride.id, 'arrived'))}
          loading={busy}
        />
      ) : null}

      {ride.status === 'DRIVER_ARRIVED' && !ride.pickupVerifiedAt ? (
        <Card>
          <Text style={type.heading}>Ask the passenger for her trip PIN</Text>
          <TextField
            label="4-digit PIN"
            keyboardType="number-pad"
            maxLength={4}
            value={pin}
            onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
          />
          <Button
            title="Verify PIN"
            onPress={() => act(() => api.verifyPin(ride.id, pin))}
            loading={busy}
            disabled={pin.length !== 4}
          />
        </Card>
      ) : null}
      {ride.status === 'DRIVER_ARRIVED' && ride.pickupVerifiedAt ? (
        <Button
          title="Start trip"
          onPress={() => act(() => api.driverRideAction(ride.id, 'start'))}
          loading={busy}
        />
      ) : null}
      {ride.status === 'IN_PROGRESS' ? (
        <Button
          title="Complete trip"
          onPress={() => act(() => api.driverRideAction(ride.id, 'complete'))}
          loading={busy}
        />
      ) : null}

      {beforePickup ? (
        <Button title="Cancel ride" variant="ghost" onPress={confirmCancel} disabled={busy} />
      ) : null}
      <Muted>In an emergency, call 112.</Muted>
    </Screen>
  );
}
