import { formatIndianMobile } from '@saheli/api-client';
import {
  Button,
  DeleteAccountCard,
  Muted,
  Screen,
  Title,
  useAuth,
  useMe,
} from '@saheli/mobile-core';

export default function DriverAccount() {
  const { signOut } = useAuth();
  const me = useMe();
  return (
    <Screen>
      <Title>{me.fullName ?? 'Your account'}</Title>
      <Muted>{formatIndianMobile(me.phone)}</Muted>
      <Button title="Sign out" variant="secondary" onPress={signOut} />
      <DeleteAccountCard consequences="Your profile, vehicle details and identity documents are deleted and you are signed out everywhere. Trip, earnings and payout records are kept in anonymised form where the law requires it. Your earnings balance must be settled first. This cannot be undone." />
    </Screen>
  );
}
