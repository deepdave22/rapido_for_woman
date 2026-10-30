import { errorMessage } from '@saheli/api-client';
import { useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from './auth';
import { Banner, Button, Card, Muted, TextField } from './components';
import { type } from './theme';

/**
 * In-app account deletion, required by both app stores. The server refuses
 * while a ride is active or money is owed, and says why.
 */
export function DeleteAccountCard({ consequences }: { consequences: string }) {
  const { api, refreshMe } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      // Tokens are gone, so this lands on the sign-in screen.
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text style={type.heading}>Delete account</Text>
      {!open ? (
        <Button title="Delete my account" variant="ghost" onPress={() => setOpen(true)} />
      ) : (
        <>
          <Muted>{consequences}</Muted>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <TextField
            label='Type "DELETE" to confirm'
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
          />
          <Button
            title="Permanently delete"
            variant="danger"
            onPress={remove}
            loading={busy}
            disabled={confirm !== 'DELETE'}
          />
          <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} disabled={busy} />
        </>
      )}
    </Card>
  );
}
