import { errorMessage, formatIndianMobile, SessionView } from '@saheli/api-client';
import {
  Banner,
  Button,
  Card,
  Muted,
  Row,
  Screen,
  TextField,
  Title,
  type,
  useAuth,
  useMe,
} from '@saheli/mobile-core';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

export default function Account() {
  const { api, refreshMe, signOut } = useAuth();
  const me = useMe();
  const [name, setName] = useState(me.fullName ?? '');
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    api
      .sessions()
      .then(setSessions)
      .catch(() => undefined);
  }, [api]);

  async function saveName() {
    try {
      await api.updateMe({ fullName: name.trim() });
      await refreshMe();
      setMessage({ tone: 'success', text: 'Saved' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  async function revoke(id: string) {
    try {
      await api.revokeSession(id);
      setSessions((s) => s.filter((x) => x.id !== id));
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  return (
    <Screen>
      <Title>{me.fullName ?? 'Your account'}</Title>
      <Muted>{formatIndianMobile(me.phone)}</Muted>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
      <Card style={{ marginTop: 16 }}>
        <TextField label="Name" value={name} onChangeText={setName} maxLength={80} />
        <Button
          title="Save"
          variant="secondary"
          onPress={saveName}
          disabled={name.trim().length < 2}
        />
      </Card>
      <Card>
        <Text style={type.heading}>Signed-in devices</Text>
        {sessions.map((s) => (
          <Row key={s.id} style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <Muted>
              {s.deviceName ?? 'Phone'}
              {s.current ? ' (this device)' : ''}
            </Muted>
            {!s.current ? (
              <Button title="Sign out" variant="ghost" onPress={() => revoke(s.id)} />
            ) : null}
          </Row>
        ))}
      </Card>
      <Button title="Sign out" variant="danger" onPress={signOut} />
    </Screen>
  );
}
