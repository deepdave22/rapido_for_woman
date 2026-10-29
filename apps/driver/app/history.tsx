import { DriverRide, errorMessage, formatInr } from '@saheli/api-client';
import { Banner, Card, Loading, Muted, Screen, type, useAuth } from '@saheli/mobile-core';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

export default function TripHistory() {
  const { api } = useAuth();
  const [trips, setTrips] = useState<DriverRide[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .driverRideHistory()
      .then(setTrips)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [api]);

  if (!trips)
    return error ? (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );
  return (
    <Screen>
      {trips.length === 0 ? <Muted>Completed trips will appear here.</Muted> : null}
      {trips.map((t) => (
        <Card key={t.id}>
          <Text style={type.body} numberOfLines={1}>
            {t.dropoff.address}
          </Text>
          <Muted>
            {new Date(t.requestedAt).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            · {t.status.toLowerCase().replace(/_/g, ' ')}
          </Muted>
          {t.finalTotalPaise !== null ? (
            <Text style={type.heading}>{formatInr(t.finalTotalPaise)}</Text>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
