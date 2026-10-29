import { errorMessage, formatDistance, formatInr, Offer } from '@saheli/api-client';
import {
  Banner,
  Button,
  Card,
  colors,
  Muted,
  Row,
  Screen,
  space,
  type,
  useAuth,
  useMe,
  useRealtime,
} from '@saheli/mobile-core';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, Vibration } from 'react-native';
import { API_URL } from '../src/config';
import { useLocationSharing } from '../src/useLocationSharing';

export default function DriverHome() {
  const { api, signOut } = useAuth();
  const me = useMe();
  const [online, setOnline] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = useLocationSharing(api, online);

  const resync = useCallback(async () => {
    try {
      const ride = await api.driverActiveRide();
      if (ride) {
        router.replace('/ride');
        return;
      }
      setOffer(await api.currentOffer());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void resync();
    }, [resync]),
  );

  useRealtime(
    API_URL,
    {
      'offer.created': (o) => {
        Vibration.vibrate([0, 400, 200, 400]);
        setOffer(o);
      },
      'offer.withdrawn': () => setOffer(null),
    },
    () => void resync(),
  );

  useEffect(() => {
    if (!offer) return;
    const tick = () => {
      const left = Math.max(
        0,
        Math.round((new Date(offer.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(left);
      if (left === 0) setOffer(null);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [offer]);

  async function toggleOnline() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setOnline(!online);
      setOnline(res.online);
      if (!res.online) setOffer(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function respond(accept: boolean) {
    if (!offer) return;
    setBusy(true);
    try {
      if (accept) {
        await api.acceptOffer(offer.id);
        router.replace('/ride');
      } else {
        await api.rejectOffer(offer.id);
      }
      setOffer(null);
    } catch (err) {
      setError(errorMessage(err));
      setOffer(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Row>
              <Pressable
                accessibilityRole="button"
                hitSlop={12}
                onPress={() => router.push('/earnings')}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Earnings</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                hitSlop={12}
                onPress={() => router.push('/history')}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Trips</Text>
              </Pressable>
            </Row>
          ),
        }}
      />
      <Text style={type.title}>Hello, {me.fullName?.split(' ')[0] ?? 'driver'}</Text>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <Card style={{ marginTop: space.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={type.heading}>{online ? 'You are online' : 'You are offline'}</Text>
        </Row>
        <Muted>
          {online
            ? location.state === 'on'
              ? 'Sharing your location. Keep the app open to receive rides.'
              : location.state === 'denied'
                ? 'Location permission is off. Turn it on to receive rides.'
                : 'Getting your location…'
            : 'Go online to start receiving ride requests.'}
        </Muted>
        {location.lastError ? <Muted>{location.lastError}</Muted> : null}
        <Button
          title={online ? 'Go offline' : 'Go online'}
          variant={online ? 'secondary' : 'primary'}
          onPress={toggleOnline}
          loading={busy && !offer}
        />
      </Card>

      {offer ? (
        <Card style={{ borderColor: colors.primary, borderWidth: 2 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={type.heading}>New {offer.categoryCode.toLowerCase()} ride</Text>
            <Text
              accessibilityLabel={`${secondsLeft} seconds left`}
              style={[type.heading, { color: colors.primary }]}
            >
              {secondsLeft}s
            </Text>
          </Row>
          <Text style={[type.title, { marginVertical: space.sm }]}>
            {formatInr(offer.estimatedEarningPaise)}
          </Text>
          <Muted>Your earning, after commission</Muted>
          <Text style={[type.body, { marginTop: space.sm }]}>
            Pickup {formatDistance(offer.pickupDistanceMeters)} away · trip{' '}
            {formatDistance(offer.tripDistanceMeters)}
          </Text>
          <Muted>From: {offer.pickupAddress}</Muted>
          <Muted>To: {offer.dropoffAddress}</Muted>
          <Row style={{ marginTop: space.md }}>
            <Button
              title="Decline"
              variant="secondary"
              onPress={() => respond(false)}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <Button
              title="Accept"
              onPress={() => respond(true)}
              loading={busy}
              style={{ flex: 2 }}
            />
          </Row>
        </Card>
      ) : null}

      <Button title="Sign out" variant="ghost" onPress={signOut} disabled={online} />
      <Muted>In an emergency, call 112.</Muted>
    </Screen>
  );
}
