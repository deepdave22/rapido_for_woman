import { errorMessage, formatInr, PassengerRide, passengerStatusText } from '@saheli/api-client';
import { Banner, Button, Card, Loading, Muted, Screen, type, useAuth } from '@saheli/mobile-core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';

export default function History() {
  const { api } = useAuth();
  const [rides, setRides] = useState<PassengerRide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(true);

  async function load(before?: string) {
    try {
      const page = await api.rideHistory(before);
      setRides((prev) => (before ? [...(prev ?? []), ...page] : page));
      setMore(page.length === 20);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!rides)
    return error ? (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );
  return (
    <Screen>
      {rides.length === 0 ? <Muted>Your rides will appear here.</Muted> : null}
      {rides.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          onPress={() => router.push(`/ride/${r.id}`)}
        >
          <Card>
            <Text style={type.body} numberOfLines={1}>
              {r.dropoff.address}
            </Text>
            <Muted>
              {new Date(r.requestedAt).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              · {passengerStatusText(r.status)}
            </Muted>
            <Text style={type.heading}>
              {formatInr(r.finalTotalPaise ?? (r.cancellationFeePaise || r.quotedTotalPaise))}
            </Text>
          </Card>
        </Pressable>
      ))}
      {more && rides.length > 0 ? (
        <Button
          title="Load more"
          variant="ghost"
          onPress={() => load(rides[rides.length - 1]!.requestedAt)}
        />
      ) : null}
    </Screen>
  );
}
