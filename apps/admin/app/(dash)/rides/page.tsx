'use client';

import { useEffect, useState } from 'react';
import { Badge, ErrorNote, PageTitle, Table } from '@/components/ui';
import { rupees, useAdmin, when } from '@/lib/client';

interface RideRow {
  id: string;
  status: string;
  categoryCode: string;
  requestedAt: string;
  pickupAddress: string;
  dropoffAddress: string;
  quotedTotalPaise: number;
  finalTotalPaise: number | null;
  paymentStatus: string;
}

interface ActiveRide {
  id: string;
  status: string;
  category_code: string;
  requested_at: string;
  pickup_address: string;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_location_at: string | null;
  open_incidents: number;
}

export default function Rides() {
  const [status, setStatus] = useState('');
  const active = useAdmin<ActiveRide[]>('rides/active');
  const list = useAdmin<RideRow[]>(`rides${status ? `?status=${status}` : ''}`);

  // Live view refreshes every 15 seconds.
  useEffect(() => {
    const t = setInterval(() => void active.reload(), 15_000);
    return () => clearInterval(t);
  }, [active]);

  return (
    <>
      <PageTitle>Rides</PageTitle>
      <h2>Live ({active.data?.length ?? 0})</h2>
      <ErrorNote error={active.error} />
      <Table
        rows={active.data}
        rowHref={(r) => `/rides/${r.id}`}
        empty="No active rides."
        columns={[
          { header: 'Ride', render: (r) => r.id.slice(0, 8) },
          { header: 'Status', render: (r) => <Badge value={r.status} /> },
          {
            header: 'Safety',
            render: (r) => (r.open_incidents ? <Badge value="CRITICAL" /> : '—'),
          },
          { header: 'Pickup', render: (r) => r.pickup_address },
          {
            header: 'Driver position',
            render: (r) =>
              r.driver_lat !== null ? (
                <a
                  href={`https://www.google.com/maps?q=${r.driver_lat},${r.driver_lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {Number(r.driver_lat).toFixed(4)}, {Number(r.driver_lng).toFixed(4)} ·{' '}
                  {when(r.driver_location_at)}
                </a>
              ) : (
                '—'
              ),
          },
        ]}
      />
      <h2>All rides</h2>
      <select
        aria-label="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        style={{ marginBottom: 12 }}
      >
        <option value="">All</option>
        {['COMPLETED', 'CANCELLED', 'NO_DRIVER_FOUND', 'IN_PROGRESS', 'SEARCHING'].map((s) => (
          <option key={s} value={s}>
            {s.toLowerCase().replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <ErrorNote error={list.error} />
      <Table
        rows={list.data}
        rowHref={(r) => `/rides/${r.id}`}
        columns={[
          { header: 'Ride', render: (r) => r.id.slice(0, 8) },
          { header: 'Requested', render: (r) => when(r.requestedAt) },
          { header: 'Status', render: (r) => <Badge value={r.status} /> },
          { header: 'Type', render: (r) => r.categoryCode },
          { header: 'Route', render: (r) => `${r.pickupAddress} → ${r.dropoffAddress}` },
          { header: 'Fare', render: (r) => rupees(r.finalTotalPaise ?? r.quotedTotalPaise) },
          { header: 'Payment', render: (r) => <Badge value={r.paymentStatus} /> },
        ]}
      />
    </>
  );
}
