import { errorMessage, TrustedContact } from '@saheli/api-client';
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
} from '@saheli/mobile-core';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

/** Trusted contacts: people who get your trip link when you press SOS (once SMS is set up). */
export default function SafetyCentre() {
  const { api } = useAuth();
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .trustedContacts()
      .then(setContacts)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [api]);

  async function add() {
    setError(null);
    try {
      const c = await api.addTrustedContact({ name: name.trim(), phone });
      setContacts((list) => [...list, c]);
      setName('');
      setPhone('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(id: string) {
    try {
      await api.removeTrustedContact(id);
      setContacts((list) => list.filter((c) => c.id !== id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Screen>
      <Title>Safety</Title>
      <Banner tone="info">
        SOS alerts the Saheli safety team. It does not call the police. In an emergency, call 112.
      </Banner>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Card>
        <Text style={type.heading}>Trusted contacts</Text>
        <Muted>Up to 5 people. When you press SOS, we try to send them your live trip link.</Muted>
        {contacts.map((c) => (
          <Row key={c.id} style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={type.body}>
              {c.name} · {c.phone}
            </Text>
            <Button title="Remove" variant="ghost" onPress={() => remove(c.id)} />
          </Row>
        ))}
      </Card>
      {contacts.length < 5 ? (
        <Card>
          <TextField label="Name" value={name} onChangeText={setName} maxLength={60} />
          <TextField
            label="Mobile number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <Button
            title="Add contact"
            onPress={add}
            disabled={name.trim().length < 1 || phone.length < 10}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
