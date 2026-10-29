'use client';

import Link from 'next/link';
import { use } from 'react';
import { ActionButton, Badge, ErrorNote, PageTitle, Table } from '@/components/ui';
import { rupees, useAdmin, when } from '@/lib/client';
import { hasRole, useStaff } from '@/lib/staff';

interface RideDetail {
  id: string;
  status: string;
  categoryCode: string;
  pickupAddress: string;
  dropoffAddress: string;
  quotedTotalPaise: number;
  finalTotalPaise: number | null;
  paymentMethod: string;
  paymentStatus: string;
  cancellationReason: string | null;
  passenger: { id: string; name: string | null; phone: string } | null;
  driver: { id: string; name: string | null; phone: string } | null;
  events: {
    id: number;
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    reason: string | null;
    createdAt: string;
  }[];
  assignments: {
    id: string;
    driverId: string;
    status: string;
    pickupDistanceMeters: number;
    offeredAt: string;
  }[];
  payments: {
    id: string;
    method: string;
    amountPaise: number;
    status: string;
    createdAt: string;
  }[];
  incidents: { id: string; type: string; status: string }[];
}

export default function RidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useStaff();
  const { data: r, error, reload } = useAdmin<RideDetail>(`rides/${id}`);
  if (!r) return <ErrorNote error={error} />;
  const live = !['COMPLETED', 'CANCELLED', 'NO_DRIVER_FOUND'].includes(r.status);

  return (
    <>
      <PageTitle
        actions={
          live && hasRole(me, 'OPERATIONS', 'SAFETY') ? (
            <ActionButton
              label="End ride (admin)"
              variant="danger"
              path={`rides/${id}/cancel`}
              reasonPrompt="Reason for ending this ride (recorded)"
              onDone={reload}
            />
          ) : null
        }
      >
        Ride {id.slice(0, 8)} <Badge value={r.status} />
      </PageTitle>
      <div className="grid">
        <div className="card">
          <dl className="kv">
            <dt>Pickup</dt>
            <dd>{r.pickupAddress}</dd>
            <dt>Drop</dt>
            <dd>{r.dropoffAddress}</dd>
            <dt>Type</dt>
            <dd>{r.categoryCode}</dd>
            <dt>Fare</dt>
            <dd>
              {rupees(r.finalTotalPaise ?? r.quotedTotalPaise)} ({r.paymentMethod.toLowerCase()},{' '}
              <Badge value={r.paymentStatus} />)
            </dd>
            {r.cancellationReason ? (
              <>
                <dt>Cancelled</dt>
                <dd>{r.cancellationReason}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <div className="card">
          <dl className="kv">
            <dt>Passenger</dt>
            <dd>
              {r.passenger ? (
                <Link href={`/passengers/${r.passenger.id}`}>{r.passenger.name ?? '—'}</Link>
              ) : (
                '—'
              )}{' '}
              {r.passenger?.phone}
            </dd>
            <dt>Driver</dt>
            <dd>
              {r.driver ? (
                <Link href={`/drivers/${r.driver.id}`}>{r.driver.name ?? '—'}</Link>
              ) : (
                '—'
              )}{' '}
              {r.driver?.phone}
            </dd>
            <dt>Incidents</dt>
            <dd>
              {r.incidents.length
                ? r.incidents.map((i) => (
                    <Link key={i.id} href={`/incidents/${i.id}`}>
                      {i.type} ({i.status.toLowerCase()}){' '}
                    </Link>
                  ))
                : 'None'}
            </dd>
          </dl>
        </div>
      </div>
      <h2>Timeline</h2>
      <ul className="timeline">
        {r.events.map((e) => (
          <li key={e.id}>
            <strong>{e.toStatus.replace(/_/g, ' ').toLowerCase()}</strong> by{' '}
            {e.actorType.toLowerCase()} · {when(e.createdAt)}
            {e.reason ? <div className="muted small">{e.reason}</div> : null}
          </li>
        ))}
      </ul>
      <h2>Dispatch offers</h2>
      <Table
        rows={r.assignments}
        columns={[
          {
            header: 'Driver',
            render: (a) => <Link href={`/drivers/${a.driverId}`}>{a.driverId.slice(0, 8)}</Link>,
          },
          { header: 'Outcome', render: (a) => <Badge value={a.status} /> },
          { header: 'Distance', render: (a) => `${a.pickupDistanceMeters} m` },
          { header: 'Offered', render: (a) => when(a.offeredAt) },
        ]}
      />
      <h2>Payments</h2>
      <Table
        rows={r.payments}
        empty="No payments recorded."
        columns={[
          { header: 'Payment', render: (p) => p.id.slice(0, 8) },
          { header: 'Method', render: (p) => p.method },
          { header: 'Amount', render: (p) => rupees(p.amountPaise) },
          { header: 'Status', render: (p) => <Badge value={p.status} /> },
          {
            header: 'Refund',
            render: (p) =>
              p.status === 'PAID' && p.method === 'ONLINE' && hasRole(me, 'SUPPORT', 'FINANCE') ? (
                <ActionButton
                  label="Request full refund"
                  variant="secondary"
                  path={`payments/${p.id}/refunds`}
                  body={{ amountPaise: p.amountPaise }}
                  reasonPrompt="Reason for refund (needs finance approval)"
                />
              ) : null,
          },
        ]}
      />
    </>
  );
}
