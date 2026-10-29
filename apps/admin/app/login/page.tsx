'use client';

import { FormEvent, useState } from 'react';

type Step =
  | { name: 'password' }
  | { name: 'enroll'; challengeToken: string; secret?: string; uri?: string }
  | { name: 'code'; challengeToken: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-saheli-csrf': '1' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? 'Sign-in failed');
  return data as T;
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step.name === 'password') {
        const r = await post<{ step: string; challengeToken: string }>('/api/session/login', {
          email,
          password,
        });
        if (r.step === 'MFA_ENROLLMENT_REQUIRED') {
          const en = await post<{ secret: string; otpauthUri: string }>('/api/session/mfa', {
            action: 'enroll',
            challengeToken: r.challengeToken,
          });
          setStep({
            name: 'enroll',
            challengeToken: r.challengeToken,
            secret: en.secret,
            uri: en.otpauthUri,
          });
        } else {
          setStep({ name: 'code', challengeToken: r.challengeToken });
        }
      } else {
        await post('/api/session/mfa', {
          action: 'verify',
          challengeToken: step.challengeToken,
          code,
        });
        window.location.href = '/';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 460, margin: '10vh auto' }}>
      <div className="card">
        <h1>Saheli Admin</h1>
        <p className="muted">Authorised operations staff only. All actions are logged.</p>
        <form className="form" onSubmit={submit}>
          {error ? (
            <p className="note error" role="alert">
              {error}
            </p>
          ) : null}
          {step.name === 'password' ? (
            <>
              <label>
                Work email
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
            </>
          ) : null}
          {step.name === 'enroll' ? (
            <div>
              <p>
                Set up two-step verification. Add this key to an authenticator app (Google
                Authenticator, Microsoft Authenticator, 1Password…):
              </p>
              <p>
                <code style={{ wordBreak: 'break-all', fontSize: 16 }}>{step.secret}</code>
              </p>
              <details>
                <summary className="small">Setup link</summary>
                <code className="small" style={{ wordBreak: 'break-all' }}>
                  {step.uri}
                </code>
              </details>
            </div>
          ) : null}
          {step.name !== 'password' ? (
            <label>
              6-digit code from your authenticator
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            </label>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : step.name === 'password' ? 'Continue' : 'Verify and sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
