import { errorMessage, formatInr, PassengerRide, passengerStatusText } from '@saheli/api-client';
import {
  Badge,
  Banner,
  Button,
  Card,
  colors,
  Loading,
  Muted,
  Row,
  Screen,
  space,
  type,
  useAuth,
  useRealtime,
} from '@saheli/mobile-core';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { API_URL } from '../../src/config';
import { RideMap } from '../../src/RideMap';

const CANCEL_REASONS = [
  'Driver is taking too long',
  'Changed my plans',
  'Booked by mistake',
  'Other',
];

export default function RideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const [ride, setRide] = useState<PassengerRide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRide(await api.ride(id));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(
    API_URL,
    {
      'ride.updated': (p: { rideId: string }) => {
        if (p.rideId === id) void load();
      },
      'driver.location': (p: { rideId: string; lat: number; lng: number; recordedAt: string }) => {
        if (p.rideId !== id) return;
        setRide((r) =>
          r?.driver
            ? {
                ...r,
                driver: {
                  ...r.driver,
                  location: { lat: p.lat, lng: p.lng, recordedAt: p.recordedAt },
                },
              }
            : r,
        );
      },
    },
    load,
  );

  function confirmCancel() {
    Alert.alert('Cancel ride?', 'A cancellation fee may apply once a driver is on the way.', [
      ...CANCEL_REASONS.map((reason) => ({ text: reason, onPress: () => void cancel(reason) })),
      { text: 'Keep ride', style: 'cancel' as const },
    ]);
  }

  async function cancel(reason: string) {
    setBusy(true);
    try {
      setRide(await api.cancelRide(id, reason));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!ride)
    return error ? (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );

  const ended =
    ride.status === 'COMPLETED' || ride.status === 'CANCELLED' || ride.status === 'NO_DRIVER_FOUND';
  const canCancel = ['SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(
    ride.status,
  );

  return (
    <Screen>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={[type.heading, { marginBottom: space.md }]}
      >
        {passengerStatusText(ride.status)}
      </Text>

      {!ended ? (
        <RideMap pickup={ride.pickup} dropoff={ride.dropoff} driver={ride.driver?.location} />
      ) : null}

      {ride.pickupPin ? (
        <Card style={{ marginTop: space.md, alignItems: 'center' }}>
          <Muted>Your trip PIN</Muted>
          <Text
            style={type.mono}
            accessibilityLabel={`Trip PIN ${ride.pickupPin.split('').join(' ')}`}
          >
            {ride.pickupPin}
          </Text>
          <Muted>Check the vehicle number first. Tell the PIN to your driver only in person.</Muted>
        </Card>
      ) : null}

      {ride.driver ? (
        <Card style={{ marginTop: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={type.heading}>{ride.driver.firstName ?? 'Your driver'}</Text>
            {ride.driver.verified ? <Badge text="✓ Verified" tone="success" /> : null}
          </Row>
          {ride.driver.vehicle ? (
            <>
              <Text style={[type.mono, { fontSize: 22, letterSpacing: 2, marginTop: space.sm }]}>
                {ride.driver.vehicle.registrationNumber}
              </Text>
              <Muted>
                {ride.driver.vehicle.colour} {ride.driver.vehicle.make} {ride.driver.vehicle.model}
              </Muted>
            </>
          ) : null}
          <Muted>
            {ride.driver.rating !== null
              ? `★ ${ride.driver.rating} (${ride.driver.ratingCount} ratings)`
              : 'New driver'}
          </Muted>
        </Card>
      ) : null}

      <Card>
        <Muted>Pickup</Muted>
        <Text style={type.body}>{ride.pickup.address}</Text>
        <View style={{ height: space.sm }} />
        <Muted>Drop</Muted>
        <Text style={type.body}>{ride.dropoff.address}</Text>
      </Card>

      {ride.status === 'COMPLETED' && ride.finalBreakdown ? (
        <Card>
          <Text style={type.heading}>Total {formatInr(ride.finalTotalPaise ?? 0)}</Text>
          <Muted>
            Paid by {ride.paymentMethod === 'CASH' ? 'cash' : 'UPI / online'} · payment{' '}
            {ride.paymentStatus.toLowerCase()}
          </Muted>
          {ride.finalBreakdown.waitingChargePaise > 0 ? (
            <Muted>
              Includes waiting charge {formatInr(ride.finalBreakdown.waitingChargePaise)}
            </Muted>
          ) : null}
        </Card>
      ) : null}

      {ride.status === 'CANCELLED' ? (
        <Banner tone="info">
          {ride.cancelledBy === 'PASSENGER'
            ? 'You cancelled this ride.'
            : 'This ride was cancelled.'}
          {ride.cancellationFeePaise > 0
            ? ` Cancellation fee: ${formatInr(ride.cancellationFeePaise)}.`
            : ''}
        </Banner>
      ) : null}
      {ride.status === 'NO_DRIVER_FOUND' ? (
        <Banner tone="warning">
          No verified driver was free nearby. You have not been charged.
        </Banner>
      ) : null}

      {canCancel ? (
        <Button title="Cancel ride" variant="secondary" onPress={confirmCancel} loading={busy} />
      ) : null}
      {ended ? <Button title="Done" onPress={() => router.replace('/')} /> : null}
      <Muted>For an emergency, call 112.</Muted>
      <View style={{ height: space.lg }} />
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>Ride {ride.id.slice(0, 8)}</Text>
    </Screen>
  );
}
