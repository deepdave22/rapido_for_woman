import { errorMessage, Place, PlaceResult, SavedPlace } from '@saheli/api-client';
import { Banner, colors, Muted, space, TextField, useAuth } from '@saheli/mobile-core';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

/** Address search with debounced server-side lookup, plus saved places. */
export function PlacePicker({
  label,
  value,
  onChange,
  near,
  saved,
}: {
  label: string;
  value: Place | null;
  onChange: (place: Place) => void;
  near?: { lat: number; lng: number } | null;
  saved: SavedPlace[];
}) {
  const { api } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!value);

  useEffect(() => {
    if (!editing || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchPlaces(query.trim(), near ?? undefined)
        .then((r) => {
          setResults(r);
          setError(null);
        })
        .catch((err: unknown) => setError(errorMessage(err)));
    }, 300);
    return () => clearTimeout(t);
  }, [query, editing, api, near]);

  function choose(p: PlaceResult) {
    onChange({ lat: p.lat, lng: p.lng, address: p.address ? `${p.name}, ${p.address}` : p.name });
    setEditing(false);
    setQuery('');
  }

  if (!editing && value) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value.address}. Tap to change`}
        onPress={() => setEditing(true)}
        style={{ paddingVertical: space.md, borderBottomWidth: 1, borderColor: colors.border }}
      >
        <Muted>{label}</Muted>
        <Text style={{ fontSize: 16, color: colors.text }} numberOfLines={2}>
          {value.address}
        </Text>
      </Pressable>
    );
  }

  return (
    <View>
      <TextField
        label={label}
        placeholder="Search for a place"
        value={query}
        onChangeText={setQuery}
        autoFocus={!value}
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {query.length < 2 && saved.length > 0
        ? saved.map((s) => (
            <ResultRow
              key={s.id}
              title={`${s.label === 'OTHER' ? s.name : s.label === 'HOME' ? 'Home' : 'Work'}`}
              subtitle={s.address}
              onPress={() => choose(s)}
            />
          ))
        : results.map((r, i) => (
            <ResultRow
              key={`${r.lat},${r.lng},${i}`}
              title={r.name}
              subtitle={r.address}
              onPress={() => choose(r)}
            />
          ))}
    </View>
  );
}

function ResultRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 48,
        paddingVertical: space.sm,
        borderBottomWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 16, color: colors.text }}>{title}</Text>
      {subtitle ? <Muted>{subtitle}</Muted> : null}
    </Pressable>
  );
}
