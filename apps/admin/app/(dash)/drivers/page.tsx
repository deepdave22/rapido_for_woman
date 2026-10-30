'use client';

import { useState } from 'react';
import { Badge, ErrorNote, PageTitle, ReviewTag, Table } from '@/components/ui';
import { useAdmin, when } from '@/lib/client';

interface DriverRow {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  submittedAt: string | null;
  vehicle: string | null;
  category: string | null;
  online: boolean | null;
  reviewAccount: boolean;
  rating: number | null;
}

const STATUSES = ['PENDING_REVIEW', 'APPROVED', 'ONBOARDING', 'REJECTED', 'SUSPENDED'];

export default function Drivers() {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [q, setQ] = useState('');
  const params = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(q.trim().length > 1 ? { q: q.trim() } : {}),
  });
  const { data, error } = useAdmin<DriverRow[]>(`drivers?${params}`);

  return (
    <>
      <PageTitle>Drivers</PageTitle>
      <div className="row" style={{ marginBottom: 12 }}>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
        <input
          aria-label="Search"
          placeholder="Name, phone or vehicle"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ErrorNote error={error} />
      <Table
        rows={data}
        rowHref={(d) => `/drivers/${d.id}`}
        columns={[
          {
            header: 'Name',
            render: (d) => (
              <>
                {d.name ?? '(no name)'}
                <ReviewTag show={d.reviewAccount} />
              </>
            ),
          },
          { header: 'Phone', render: (d) => d.phone },
          { header: 'Status', render: (d) => <Badge value={d.status} /> },
          { header: 'Vehicle', render: (d) => (d.vehicle ? `${d.vehicle} · ${d.category}` : '—') },
          { header: 'Online', render: (d) => (d.online ? 'Yes' : 'No') },
          { header: 'Rating', render: (d) => d.rating ?? '—' },
          { header: 'Submitted', render: (d) => when(d.submittedAt) },
        ]}
      />
    </>
  );
}
