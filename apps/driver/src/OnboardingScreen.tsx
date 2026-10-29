import { errorMessage, Onboarding, VehicleInput } from '@saheli/api-client';
import {
  Badge,
  Banner,
  Button,
  Card,
  Loading,
  Muted,
  Row,
  Screen,
  TextField,
  Title,
  type,
  useAuth,
  useMe,
} from '@saheli/mobile-core';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

const DOCUMENT_LABELS: Record<string, string> = {
  PROFILE_PHOTO: 'Profile photo',
  IDENTITY_PROOF: 'Identity proof',
  DRIVING_LICENCE: 'Driving licence',
  VEHICLE_RC: 'Vehicle registration (RC)',
  VEHICLE_INSURANCE: 'Vehicle insurance',
  VEHICLE_PERMIT: 'Commercial permit',
};

/** Shown until an operations reviewer approves the driver. */
export function OnboardingScreen() {
  const { api, refreshMe, signOut } = useAuth();
  const me = useMe();
  const [state, setState] = useState<Onboarding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState(me.fullName ?? '');
  const [vehicle, setVehicle] = useState<VehicleInput>({
    categoryCode: 'AUTO',
    registrationNumber: '',
    make: '',
    model: '',
    colour: '',
  });

  const load = useCallback(async () => {
    try {
      const s = await api.onboarding();
      setState(s);
      if (s.vehicle) {
        setVehicle({
          categoryCode: s.vehicle.categoryCode as VehicleInput['categoryCode'],
          registrationNumber: s.vehicle.registrationNumber,
          make: s.vehicle.make,
          model: s.vehicle.model,
          colour: s.vehicle.colour,
        });
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function upload(type: string) {
    const picked = await DocumentPicker.getDocumentAsync({
      type:
        type === 'PROFILE_PHOTO'
          ? ['image/jpeg', 'image/png']
          : ['image/jpeg', 'image/png', 'application/pdf'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    await run(type, () =>
      api.uploadDocument(type, {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
      }),
    );
  }

  if (!state)
    return error ? (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );
  const editable = state.status === 'ONBOARDING' || state.status === 'REJECTED';

  return (
    <Screen>
      <Title>Become a Saheli driver</Title>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {state.status === 'PENDING_REVIEW' ? (
        <Banner tone="info">
          Thank you. Our team is reviewing your documents. We will notify you when you are approved.
        </Banner>
      ) : null}
      {state.status === 'REJECTED' ? (
        <Banner tone="warning">
          Some details need attention{state.statusReason ? `: ${state.statusReason}` : ''}. Please
          update and resubmit.
        </Banner>
      ) : null}
      {state.status === 'SUSPENDED' ? (
        <Banner tone="error">
          Your account is suspended{state.statusReason ? `: ${state.statusReason}` : ''}. Contact
          support to appeal.
        </Banner>
      ) : null}

      <Card>
        <Text style={type.heading}>1. Your name</Text>
        <TextField
          label="Full name as on your licence"
          value={name}
          onChangeText={setName}
          editable={editable}
        />
        {editable ? (
          <Button
            title="Save name"
            variant="secondary"
            loading={busy === 'name'}
            disabled={name.trim().length < 2}
            onPress={() =>
              run('name', async () => {
                await api.updateMe({ fullName: name.trim() });
                await refreshMe();
              })
            }
          />
        ) : null}
      </Card>

      <Card>
        <Text style={type.heading}>2. Vehicle</Text>
        <Row style={{ marginVertical: 8 }}>
          {(['BIKE', 'AUTO', 'CAB'] as const).map((c) => (
            <Button
              key={c}
              title={c === 'BIKE' ? 'Bike' : c === 'AUTO' ? 'Auto' : 'Cab'}
              variant={vehicle.categoryCode === c ? 'primary' : 'secondary'}
              onPress={() => setVehicle({ ...vehicle, categoryCode: c })}
              disabled={!editable}
              style={{ flex: 1 }}
            />
          ))}
        </Row>
        <TextField
          label="Registration number"
          placeholder="KA 01 AB 1234"
          autoCapitalize="characters"
          value={vehicle.registrationNumber}
          onChangeText={(v) => setVehicle({ ...vehicle, registrationNumber: v })}
          editable={editable}
        />
        <TextField
          label="Make"
          placeholder="Bajaj"
          value={vehicle.make}
          onChangeText={(v) => setVehicle({ ...vehicle, make: v })}
          editable={editable}
        />
        <TextField
          label="Model"
          value={vehicle.model}
          onChangeText={(v) => setVehicle({ ...vehicle, model: v })}
          editable={editable}
        />
        <TextField
          label="Colour"
          value={vehicle.colour}
          onChangeText={(v) => setVehicle({ ...vehicle, colour: v })}
          editable={editable}
        />
        {editable ? (
          <Button
            title="Save vehicle"
            variant="secondary"
            loading={busy === 'vehicle'}
            onPress={() => run('vehicle', () => api.saveVehicle(vehicle))}
          />
        ) : null}
      </Card>

      <Card>
        <Text style={type.heading}>3. Documents</Text>
        <Muted>
          Clear photos or PDFs, up to 10 MB each. Documents are stored privately and seen only by
          our verification team.
        </Muted>
        {state.requiredDocuments.map((t) => {
          const doc = state.documents.find((d) => d.type === t);
          return (
            <View key={t} style={{ marginTop: 12 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={type.body}>{DOCUMENT_LABELS[t] ?? t}</Text>
                <Badge
                  text={doc ? doc.status.toLowerCase() : 'missing'}
                  tone={
                    doc?.status === 'APPROVED'
                      ? 'success'
                      : doc && doc.status !== 'REJECTED'
                        ? 'neutral'
                        : 'warning'
                  }
                />
              </Row>
              {doc?.rejectionReason ? <Muted>{doc.rejectionReason}</Muted> : null}
              {editable ? (
                <Button
                  title={doc ? 'Replace' : 'Upload'}
                  variant="ghost"
                  loading={busy === t}
                  onPress={() => upload(t)}
                />
              ) : null}
            </View>
          );
        })}
      </Card>

      {editable ? (
        <Button
          title="Submit for review"
          onPress={() => run('submit', () => api.submitForReview())}
          loading={busy === 'submit'}
          disabled={!state.canSubmit}
        />
      ) : (
        <Button
          title="Check status"
          variant="secondary"
          onPress={() => run('refresh', refreshMe)}
          loading={busy === 'refresh'}
        />
      )}
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
