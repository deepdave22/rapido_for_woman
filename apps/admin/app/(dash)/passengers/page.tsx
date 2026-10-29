'use client';

import { useState } from 'react';
import { Badge, ErrorNote, PageTitle, Table } from '@/components/ui';
import { useAdmin, when } from '@/lib/client';

interface PassengerRow {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  eligibility: string;
  createdAt: string;
}

export default function Passengers() {
  const [q, setQ] = useState('');
  const { data, error } = useAdmin<PassengerRow[]>(
    `passengers${q.trim().length > 1 ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
  );
  return (
    <>
      <PageTitle>Passengers</PageTitle>
      <input
        aria-label="Search"
        placeholder="Name or phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      <ErrorNote error={error} />
      <Table
        rows={data}
        rowHref={(p) => `/passengers/${p.id}`}
        columns={[
          { header: 'Name', render: (p) => p.name ?? '(no name)' },
          { header: 'Phone', render: (p) => p.phone },
          { header: 'Account', render: (p) => <Badge value={p.status} /> },
          { header: 'Eligibility', render: (p) => <Badge value={p.eligibility} /> },
          { header: 'Joined', render: (p) => when(p.createdAt) },
        ]}
      />
    </>
  );
}
