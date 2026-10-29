'use client';

import Link from 'next/link';
import { use } from 'react';
import { ActionButton, Badge, ErrorNote, PageTitle, Table } from '@/components/ui';
import { rupees, useAdmin, when } from '@/lib/client';
import { hasRole, useStaff } from '@/lib/staff';

interface PassengerDetail {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  suspendedReason: string | null;
  eligibilityStatus: string;
  termsVersionAccepted: string | null;
  createdAt: string;
  rides: { id: string; status: string; requestedAt: string; total: number | null }[];
  tickets: { id: string; subject: string; status: string }[];
  incidents: { id: string; type: string; status: string }[];
}

export default function PassengerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useStaff();
  const { data: p, error, reload } = useAdmin<PassengerDetail>(`passengers/${id}`);
  if (!p) return <ErrorNote error={error} />;
  const canAct = hasRole(me, 'OPERATIONS', 'SAFETY');

  return (
    <>
      <PageTitle
        actions={
          canAct ? (
            p.status === 'SUSPENDED' ? (
              <ActionButton
                label="Reactivate"
                path={`users/${id}/reactivate`}
                reasonPrompt="Reason for reactivation"
                onDone={reload}
              />
            ) : (
              <ActionButton
                label="Suspend account"
                variant="danger"
                path={`users/${id}/suspend`}
                reasonPrompt="Reason for suspension (signs out all devices)"
                onDone={reload}
              />
            )
          ) : null
        }
      >
        {p.name ?? 'Passenger'} <Badge value={p.status} />
      </PageTitle>
      <div className="card">
        <dl className="kv">
          <dt>Phone</dt>
          <dd>{p.phone}</dd>
          <dt>Eligibility</dt>
          <dd>
            <Badge value={p.eligibilityStatus} />
          </dd>
          <dt>Terms</dt>
          <dd>{p.termsVersionAccepted ?? 'Not accepted'}</dd>
          <dt>Joined</dt>
          <dd>{when(p.createdAt)}</dd>
          {p.suspendedReason ? (
            <>
              <dt>Suspended</dt>
              <dd>{p.suspendedReason}</dd>
            </>
          ) : null}
        </dl>
      </div>
      <h2>Recent rides</h2>
      <Table
        rows={p.rides}
        rowHref={(r) => `/rides/${r.id}`}
        columns={[
          { header: 'Ride', render: (r) => r.id.slice(0, 8) },
          { header: 'When', render: (r) => when(r.requestedAt) },
          { header: 'Status', render: (r) => <Badge value={r.status} /> },
          { header: 'Total', render: (r) => rupees(r.total) },
        ]}
      />
      <h2>Support and safety</h2>
      <ul>
        {p.tickets.map((t) => (
          <li key={t.id}>
            <Link href={`/tickets/${t.id}`}>{t.subject}</Link> ({t.status.toLowerCase()})
          </li>
        ))}
        {p.incidents.map((i) => (
          <li key={i.id}>
            <Link href={`/incidents/${i.id}`}>{i.type.toLowerCase()}</Link> (
            {i.status.toLowerCase()})
          </li>
        ))}
        {!p.tickets.length && !p.incidents.length ? <li className="muted">None</li> : null}
      </ul>
    </>
  );
}
