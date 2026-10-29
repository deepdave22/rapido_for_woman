import { errorMessage, SosResult } from '@saheli/api-client';
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, Text, View } from 'react-native';
import { useAuth } from './auth';
import { Button } from './components';
import { colors, radius, space, type } from './theme';

function contactsLine(r: SosResult): string | null {
  const c = r.trustedContacts;
  if (!c) return null;
  if (c.status === 'NO_CONTACTS_SAVED') return 'You have no trusted contacts saved.';
  if (c.status === 'SENT') return `Your ${c.sent} trusted contact(s) were sent an SMS.`;
  if (c.reason === 'SMS_PROVIDER_NOT_CONFIGURED') {
    return 'Your trusted contacts could NOT be messaged: SMS is not set up yet. Call them yourself if you can.';
  }
  return `Only ${c.sent} of ${c.saved} trusted contacts could be messaged.`;
}

/**
 * Always-visible SOS during a ride. Confirms first (to avoid pocket presses),
 * then shows exactly what the server reports; it never claims help is on the
 * way unless the safety team has recorded a response.
 */
export function SosButton({
  rideId,
  getLocation,
}: {
  rideId?: string;
  getLocation?: () => Promise<{ lat: number; lng: number } | null>;
}) {
  const { api } = useAuth();
  const [result, setResult] = useState<SosResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const loc = await getLocation?.().catch(() => null);
      setResult(await api.sos({ rideId, ...(loc ?? {}) }));
    } catch (err) {
      Alert.alert('SOS not sent', `${errorMessage(err)}\n\nIf you are in danger, call 112 now.`, [
        { text: 'Call 112', onPress: () => void Linking.openURL('tel:112') },
        { text: 'Close', style: 'cancel' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    Alert.alert('Send SOS?', 'This alerts the Saheli safety team with your ride and location.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send SOS', style: 'destructive', onPress: () => void send() },
    ]);
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="SOS. Alert the safety team"
        onPress={confirm}
        disabled={busy}
        style={({ pressed }) => ({
          backgroundColor: colors.sos,
          opacity: pressed || busy ? 0.8 : 1,
          minHeight: 56,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          marginVertical: space.sm,
        })}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 1 }}>
          {busy ? 'SENDING…' : 'SOS'}
        </Text>
      </Pressable>
      <Modal
        visible={!!result}
        transparent
        animationType="fade"
        onRequestClose={() => setResult(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'center',
            padding: space.lg,
          }}
        >
          <View
            style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg }}
          >
            <Text accessibilityRole="header" style={type.heading}>
              Alert received
            </Text>
            <Text style={[type.body, { marginTop: space.sm }]}>{result?.message}</Text>
            {result && contactsLine(result) ? (
              <Text style={[type.body, { marginTop: space.sm }]}>{contactsLine(result)}</Text>
            ) : null}
            <Button
              title="Call 112"
              variant="danger"
              onPress={() => void Linking.openURL('tel:112')}
            />
            <Button title="Close" variant="ghost" onPress={() => setResult(null)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
