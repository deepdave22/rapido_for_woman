import { colors } from '@saheli/mobile-core';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

interface Point {
  lat: number;
  lng: number;
}

/** Map with pickup, drop and (optionally) the driver, framed to fit all of them. */
export function RideMap({
  pickup,
  dropoff,
  driver,
  height = 260,
}: {
  pickup?: Point | null;
  dropoff?: Point | null;
  driver?: Point | null;
  height?: number;
}) {
  const ref = useRef<MapView>(null);
  const points = [pickup, dropoff, driver].filter((p): p is Point => !!p);

  useEffect(() => {
    if (!points.length) return;
    ref.current?.fitToCoordinates(
      points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    );
    // Refit only when the set of points changes meaningfully.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driver?.lat, driver?.lng]);

  return (
    <MapView
      ref={ref}
      style={[styles.map, { height }]}
      initialRegion={{
        latitude: 12.9716,
        longitude: 77.5946,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      }}
      showsUserLocation
      accessibilityLabel="Map showing pickup and drop"
    >
      {pickup ? (
        <Marker
          coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
          title="Pickup"
          pinColor={colors.primary}
        />
      ) : null}
      {dropoff ? (
        <Marker
          coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
          title="Drop"
          pinColor={colors.accent}
        />
      ) : null}
      {driver ? (
        <Marker
          coordinate={{ latitude: driver.lat, longitude: driver.lng }}
          title="Your driver"
          pinColor="green"
        />
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({ map: { width: '100%', borderRadius: 16 } });
