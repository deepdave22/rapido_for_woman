import { ApiError, ClientApp, errorMessage, Me, SaheliClient, Tokens } from '@saheli/api-client';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Text, View } from 'react-native';
import { Banner, Button, Muted, Screen, TextField, Title } from './components';
import { colors, space } from './theme';

const TOKEN_KEY = 'saheli.tokens.v1';

/** Tokens live in the OS keystore (Keychain / Android Keystore), never in plain storage. */
const secureTokenStore = {
  async get(): Promise<Tokens | null> {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  },
  async set(tokens: Tokens) {
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: Me };

interface AuthContextValue {
  state: AuthState;
  api: SaheliClient;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  app,
  apiUrl,
  children,
}: {
  app: ClientApp;
  apiUrl: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const signedOut = useRef(() => setState({ status: 'signedOut' }));

  const api = useMemo(
    () =>
      new SaheliClient({
        baseUrl: apiUrl,
        app,
        tokens: secureTokenStore,
        newIdempotencyKey: () => Crypto.randomUUID(),
        onSignedOut: () => signedOut.current(),
      }),
    [apiUrl, app],
  );

  const refreshMe = useCallback(async () => {
    if (!(await secureTokenStore.get())) {
      setState({ status: 'signedOut' });
      return;
    }
    try {
      setState({ status: 'signedIn', me: await api.me() });
    } catch (err) {
      // Offline at launch: keep the user signed in only if we know who they are.
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        setState((s) => (s.status === 'signedIn' ? s : { status: 'signedOut' }));
      } else {
        setState({ status: 'signedOut' });
      }
    }
  }, [api]);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setState({ status: 'signedOut' });
  }, [api]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  return (
    <AuthContext.Provider value={{ state, api, refreshMe, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Signed-in user; only call where the router guarantees a session. */
export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useMe used while signed out');
  return state.me;
}

/** Phone number → OTP sign-in, shared by both apps. */
export function PhoneSignIn({ appName, tagline }: { appName: string; tagline: string }) {
  const { api, refreshMe } = useAuth();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; resendAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!challenge) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [challenge]);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestOtp(phone);
      setChallenge({ id: res.challengeId, resendAt: Date.now() + res.resendAfterSeconds * 1000 });
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifyOtp(challenge.id, code);
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const resendIn = challenge ? Math.max(0, Math.ceil((challenge.resendAt - now) / 1000)) : 0;

  return (
    <Screen>
      <View style={{ marginTop: space.xxl }}>
        <Title>{appName}</Title>
        <Muted>{tagline}</Muted>
      </View>
      <View style={{ marginTop: space.xl }}>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {!challenge ? (
          <>
            <TextField
              label="Mobile number"
              placeholder="98765 43210"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              value={phone}
              onChangeText={setPhone}
              maxLength={16}
            />
            <Button
              title="Send code"
              onPress={sendCode}
              loading={busy}
              disabled={phone.trim().length < 10}
            />
            <Text style={{ marginTop: space.md, color: colors.textMuted }}>
              We will send a 6-digit code by SMS. Standard SMS charges may apply.
            </Text>
          </>
        ) : (
          <>
            <TextField
              label="6-digit code"
              placeholder="••••••"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
            />
            <Button
              title="Verify and continue"
              onPress={verify}
              loading={busy}
              disabled={code.length !== 6}
            />
            <Button
              title={resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              variant="ghost"
              onPress={sendCode}
              disabled={resendIn > 0 || busy}
            />
            <Button title="Change number" variant="ghost" onPress={() => setChallenge(null)} />
          </>
        )}
      </View>
    </Screen>
  );
}
