'use client';

import { FormEvent, useState } from 'react';
import { ActionButton, Badge, ErrorNote, PageTitle, Table } from '@/components/ui';
import { adminApi, useAdmin, when } from '@/lib/client';

interface StaffRow {
  id: string;
  email: string;
  fullName: string;
  status: string;
  mfaEnrolled: boolean;
  lastLoginAt: string | null;
  roles: string[];
}

const ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT', 'FINANCE', 'SAFETY'];

export default function Staff() {
  const { data, error, reload } = useAdmin<StaffRow[]>('staff');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roles, setRoles] = useState<string[]>(['SUPPORT']);
  const [created, setCreated] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const res = await adminApi<{ email: string; temporaryPassword: string }>('staff', {
        method: 'POST',
        body: { email, fullName, roles },
      });
      setCreated(res);
      setEmail('');
      setFullName('');
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <>
      <PageTitle>Staff</PageTitle>
      <p className="muted">
        One account per person. Never share credentials. Two-step verification is required for
        everyone.
      </p>
      <ErrorNote error={error} />
      <Table
        rows={data}
        columns={[
          { header: 'Name', render: (s) => s.fullName },
          { header: 'Email', render: (s) => s.email },
          { header: 'Roles', render: (s) => s.roles.join(', ').toLowerCase() },
          { header: 'Status', render: (s) => <Badge value={s.status} /> },
          { header: 'MFA', render: (s) => (s.mfaEnrolled ? 'Set up' : 'Pending first sign-in') },
          { header: 'Last sign-in', render: (s) => when(s.lastLoginAt) },
          {
            header: '',
            render: (s) => (
              <ActionButton
                label={s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                variant={s.status === 'ACTIVE' ? 'danger' : 'secondary'}
                method="PATCH"
                path={`staff/${s.id}`}
                body={{ status: s.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }}
                confirmText={
                  s.status === 'ACTIVE'
                    ? `Disable ${s.email}? They are signed out at once.`
                    : `Enable ${s.email}?`
                }
                onDone={reload}
              />
            ),
          },
        ]}
      />
      <h2>Add staff member</h2>
      {created ? (
        <p className="card">
          Created {created.email}. Temporary password (shown once, share it securely):{' '}
          <code>{created.temporaryPassword}</code>
        </p>
      ) : null}
      <form className="form" onSubmit={create}>
        <ErrorNote error={formError} />
        <label>
          Full name
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            minLength={2}
          />
        </label>
        <label>
          Work email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <fieldset className="card">
          <legend>Roles</legend>
          {ROLES.map((r) => (
            <label key={r} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={roles.includes(r)}
                onChange={(e) =>
                  setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))
                }
              />{' '}
              {r.toLowerCase().replace('_', ' ')}
            </label>
          ))}
        </fieldset>
        <button className="btn btn-primary" type="submit" disabled={!roles.length}>
          Create
        </button>
      </form>
    </>
  );
}
