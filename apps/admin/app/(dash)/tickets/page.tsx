'use client';

import { useState } from 'react';
import { Badge, ErrorNote, PageTitle, Table } from '@/components/ui';
import { useAdmin, when } from '@/lib/client';

interface TicketRow {
  id: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
}

export default function Tickets() {
  const [status, setStatus] = useState('');
  const { data, error } = useAdmin<TicketRow[]>(`tickets${status ? `?status=${status}` : ''}`);
  return (
    <>
      <PageTitle>Support</PageTitle>
      <select
        aria-label="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        style={{ marginBottom: 12 }}
      >
        <option value="">Open queue</option>
        {['RESOLVED', 'CLOSED'].map((s) => (
          <option key={s} value={s}>
            {s.toLowerCase()}
          </option>
        ))}
      </select>
      <ErrorNote error={error} />
      <Table
        rows={data}
        rowHref={(t) => `/tickets/${t.id}`}
        empty="No open tickets."
        columns={[
          { header: 'Subject', render: (t) => t.subject },
          { header: 'Priority', render: (t) => <Badge value={t.priority} /> },
          { header: 'Category', render: (t) => t.category.replace(/_/g, ' ').toLowerCase() },
          { header: 'Status', render: (t) => <Badge value={t.status} /> },
          { header: 'Updated', render: (t) => when(t.updatedAt) },
        ]}
      />
    </>
  );
}
