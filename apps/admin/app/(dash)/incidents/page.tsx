'use client';

import { useEffect, useState } from 'react';
import { Badge, ErrorNote, PageTitle, ReviewTag, Table } from '@/components/ui';
import { useAdmin, when } from '@/lib/client';

interface IncidentRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  rideId: string | null;
  reporterRole: string;
  reviewAccount: boolean | null;
  createdAt: string;
  acknowledgedAt: string | null;
}

export default function Incidents() {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useAdmin<IncidentRow[]>(
    `incidents${status ? `?status=${status}` : ''}`,
  );

  // The open queue refreshes every 10 seconds so new SOS alerts surface quickly.
  useEffect(() => {
    const t = setInterval(() => void reload(), 10_000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <>
      <PageTitle>Safety incidents</PageTitle>
      <p className="muted">
        Most severe and oldest first. Acknowledge an SOS immediately; record a response only when
        action has actually been taken.
      </p>
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
        rowHref={(i) => `/incidents/${i.id}`}
        empty="No open incidents."
        columns={[
          {
            header: 'Incident',
            render: (i) => `${i.type.replace(/_/g, ' ').toLowerCase()} · ${i.id.slice(0, 8)}`,
          },
          { header: 'Severity', render: (i) => <Badge value={i.severity} /> },
          { header: 'Status', render: (i) => <Badge value={i.status} /> },
          {
            header: 'Reported by',
            render: (i) => (
              <>
                {i.reporterRole.toLowerCase()}
                <ReviewTag show={i.reviewAccount} />
              </>
            ),
          },
          { header: 'Raised', render: (i) => when(i.createdAt) },
          { header: 'Acknowledged', render: (i) => when(i.acknowledgedAt) },
        ]}
      />
    </>
  );
}
