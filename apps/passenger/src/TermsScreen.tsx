import { errorMessage } from '@saheli/api-client';
import {
  Banner,
  Button,
  Card,
  Muted,
  Screen,
  TextField,
  Title,
  useAuth,
  useMe,
} from '@saheli/mobile-core';
import { useState } from 'react';
import { Text } from 'react-native';

/**
 * First-run: name and acceptance of the rider terms and privacy notice. The
 * wording below is a draft placeholder pending legal review.
 */
export function TermsScreen() {
  const { api, refreshMe } = useAuth();
  const me = useMe();
  const [name, setName] = useState(me.fullName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      if (name.trim() !== me.fullName) await api.updateMe({ fullName: name.trim() });
      await api.acceptTerms(me.currentTermsVersion);
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Welcome to Saheli</Title>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <TextField
        label="Your name"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        maxLength={80}
      />
      <Card>
        <Text style={{ fontWeight: '600', marginBottom: 8 }}>Before your first ride</Text>
        <Muted>
          • Every driver is a woman whose identity, licence and vehicle documents have been checked
          by our team.
        </Muted>
        <Muted>
          • Share your 4-digit trip PIN only in person, after checking the vehicle number.
        </Muted>
        <Muted>
          • The SOS button alerts our safety team. It does not automatically contact the police. In
          an emergency, call 112.
        </Muted>
        <Muted>• Your live location is shared with your driver only during your ride.</Muted>
      </Card>
      <Muted>
        By continuing you agree to the Rider Terms and Privacy Notice (version{' '}
        {me.currentTermsVersion}).
      </Muted>
      <Button
        title="Agree and continue"
        onPress={accept}
        loading={busy}
        disabled={name.trim().length < 2}
        style={{ marginTop: 16 }}
      />
    </Screen>
  );
}
