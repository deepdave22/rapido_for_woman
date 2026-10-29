'use client';

import { useState } from 'react';
import { ErrorNote, PageTitle, Table } from '@/components/ui';
import { useAdmin, when } from '@/lib/client';

interface AuditRow {
  id: number;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export default function Audit() {
  const [entityType, setEntityType] = useState('');
  const { data, error } = useAdmin<AuditRow[]>(
    `audit${entityType ? `?entityType=${encodeURIComponent(entityType)}` : ''}`,
  );
  return (
    <>
      <PageTitle>Audit log</PageTitle>
      <p className="muted">
        Append-only. Entries cannot be edited or deleted, including by administrators.
      </p>
      <input
        aria-label="Entity type"
        placeholder="Filter by entity type, e.g. driver"
        value={entityType}
        onChange={(e) => setEntityType(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      <ErrorNote error={error} />
      <Table
        rows={data}
        columns={[
          { header: 'When', render: (a) => when(a.createdAt) },
          {
            header: 'Actor',
            render: (a) => `${a.actorType.toLowerCase()} ${a.actorId?.slice(0, 8) ?? ''}`,
          },
          { header: 'Action', render: (a) => a.action },
          { header: 'Entity', render: (a) => `${a.entityType} ${a.entityId?.slice(0, 8) ?? ''}` },
          {
            header: 'Details',
            render: (a) =>
              a.metadata ? <code className="small">{JSON.stringify(a.metadata)}</code> : '—',
          },
        ]}
      />
    </>
  );
}
