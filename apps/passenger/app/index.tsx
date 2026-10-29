import {
  ApiError,
  errorMessage,
  formatDistance,
  formatDuration,
  formatInr,
  Place,
  QuoteResponse,
  SavedPlace,
} from '@saheli/api-client';
import {
  Banner,
  Button,
  Card,
  colors,
  Muted,
  Row,
  Screen,
  space,
  useAuth,
} from '@saheli/mobile-core';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PlacePicker } from '../src/PlacePicker';
import { RideMap } from '../src/RideMap';

export default function Home() {
  const { api } = useAuth();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [payment, setPayment] = useState<'CASH' | 'ONLINE'>('CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per booking attempt, reused if the user retries after a network error.
  const [bookingKey, setBookingKey] = useState(() => Crypto.randomUUID());

  useFocusEffect(
    useCallback(() => {
      api
        .activeRide()
        .then((ride) => ride && router.replace(`/ride/${ride.id}`))
        .catch(() => undefined);
      api
        .savedPlaces()
        .then(setSaved)
        .catch(() => undefined);
    }, [api]),
  );

  async function useCurrentLocation() {
    setError(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      setError('Location permission is off. Search for your pickup instead.');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setPickup({ lat: pos.coords.latitude, lng: pos.coords.longitude, address: 'Current location' });
    setQuote(null);
  }

  async function getPrices() {
    if (!pickup || !dropoff) return;
    setBusy(true);
    setError(null);
    try {
      const q = await api.quote(pickup, dropoff);
      setQuote(q);
      setSelected(q.options.find((o) => o.driversNearby)?.quoteId ?? q.options[0]?.quoteId ?? null);
      setBookingKey(Crypto.randomUUID());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const ride = await api.book(selected, payment, bookingKey);
      router.replace(`/ride/${ride.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'QUOTE_EXPIRED') {
        setQuote(null);
        setError('Prices changed. Tap "See prices" again.');
      } else if (err instanceof ApiError && err.code === 'ACTIVE_RIDE_EXISTS') {
        const active = await api.activeRide().catch(() => null);
        if (active) router.replace(`/ride/${active.id}`);
      } else {
        setError(errorMessage(err));
      }
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
              <HeaderLink label="Rides" onPress={() => router.push('/history')} />
              <HeaderLink label="Safety" onPress={() => router.push('/safety')} />
              <HeaderLink label="Account" onPress={() => router.push('/account')} />
            </Row>
          ),
        }}
      />
      <RideMap pickup={pickup} dropoff={dropoff} height={220} />
      <Card style={{ marginTop: space.md }}>
        <PlacePicker
          label="Pickup"
          value={pickup}
          onChange={(p) => (setPickup(p), setQuote(null))}
          saved={saved}
        />
        <Button title="Use my current location" variant="ghost" onPress={useCurrentLocation} />
        <PlacePicker
          label="Drop"
          value={dropoff}
          onChange={(p) => (setDropoff(p), setQuote(null))}
          near={pickup}
          saved={saved}
        />
      </Card>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {!quote ? (
        <Button
          title="See prices"
          onPress={getPrices}
          loading={busy}
          disabled={!pickup || !dropoff}
        />
      ) : (
        <>
          <Muted>
            {formatDistance(quote.route.distanceMeters)} · about{' '}
            {formatDuration(quote.route.durationSeconds)}
            {quote.route.provider === 'estimate-dev' ? ' · estimated (development)' : ''}
          </Muted>
          {quote.options.map((o) => (
            <Pressable
              key={o.quoteId}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected === o.quoteId }}
              onPress={() => setSelected(o.quoteId)}
            >
              <Card
                style={
                  selected === o.quoteId
                    ? { borderColor: colors.primary, borderWidth: 2 }
                    : undefined
                }
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <View>
                    <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text }}>
                      {o.displayName} · {o.seats} seat{o.seats > 1 ? 's' : ''}
                    </Text>
                    <Muted>
                      {o.pickupEtaSeconds !== null
                        ? `Driver about ${formatDuration(o.pickupEtaSeconds)} away`
                        : 'No drivers nearby right now'}
                    </Muted>
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>
                    {formatInr(o.totalPaise)}
                  </Text>
                </Row>
                {selected === o.quoteId ? <FareLines breakdown={o.breakdown} /> : null}
              </Card>
            </Pressable>
          ))}
          <Row style={{ marginVertical: space.sm }}>
            <Button
              title="Cash"
              variant={payment === 'CASH' ? 'primary' : 'secondary'}
              onPress={() => setPayment('CASH')}
              style={{ flex: 1 }}
            />
            <Button
              title="UPI / Online"
              variant={payment === 'ONLINE' ? 'primary' : 'secondary'}
              onPress={() => setPayment('ONLINE')}
              style={{ flex: 1 }}
            />
          </Row>
          <Button title="Book ride" onPress={book} loading={busy} disabled={!selected} />
        </>
      )}
    </Screen>
  );
}

function FareLines({ breakdown }: { breakdown: QuoteResponse['options'][number]['breakdown'] }) {
  const lines: [string, number][] = [
    ['Base fare', breakdown.baseFarePaise],
    ['Distance', breakdown.distanceChargePaise],
    ['Time', breakdown.timeChargePaise],
    ['Minimum fare adjustment', breakdown.minimumFareAdjustmentPaise],
    ['Surcharge', breakdown.surchargePaise],
    ['Discount', -breakdown.discountPaise],
    ['Booking fee', breakdown.bookingFeePaise],
    ['Taxes', breakdown.taxPaise],
    ['Rounding', breakdown.roundingAdjustmentPaise],
  ];
  return (
    <View style={{ marginTop: space.sm }}>
      {lines
        .filter(([, v]) => v !== 0)
        .map(([label, v]) => (
          <Row key={label} style={{ justifyContent: 'space-between' }}>
            <Muted>{label}</Muted>
            <Muted>{v < 0 ? `−${formatInr(-v)}` : formatInr(v)}</Muted>
          </Row>
        ))}
    </View>
  );
}

function HeaderLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={12}
      style={{ paddingHorizontal: 6 }}
    >
      <Text style={{ color: colors.primary, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
