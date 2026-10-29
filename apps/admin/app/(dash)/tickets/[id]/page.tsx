'use client';

import Link from 'next/link';
import { FormEvent, use, useState } from 'react';
import { ActionButton, Badge, ErrorNote, PageTitle } from '@/components/ui';
import { adminApi, useAdmin, when } from '@/lib/client';

interface TicketDetail {
  id: string;
  userId: string;
  rideId: string | null;
  subject: string;
  category: string;
  priority: string;
  status: string;
  messages: {
    id: number;
    authorUserId: string | null;
    authorStaffId: string | null;
    body: string;
    internalNote: boolean;
    createdAt: string;
  }[];
}

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: t, error, reload } = useAdmin<TicketDetail>(`tickets/${id}`);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    try {
      await adminApi(`tickets/${id}/messages`, { method: 'POST', body: { body, internal } });
      setBody('');
      await reload();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed');
    }
  }

  if (!t) return <ErrorNote error={error} />;
  return (
    <>
      <PageTitle
        actions={
          <>
            {t.status !== 'RESOLVED' ? (
              <ActionButton
                label="Mark resolved"
                variant="secondary"
                path={`tickets/${id}/status`}
                body={{ status: 'RESOLVED' }}
                onDone={reload}
              />
            ) : null}
            {t.status === 'RESOLVED' ? (
              <ActionButton
                label="Close"
                variant="secondary"
                path={`tickets/${id}/status`}
                body={{ status: 'CLOSED' }}
                onDone={reload}
              />
            ) : null}
          </>
        }
      >
        {t.subject} <Badge value={t.priority} /> <Badge value={t.status} />
      </PageTitle>
      <p className="muted">
        {t.category.toLowerCase().replace(/_/g, ' ')} · user{' '}
        <Link href={`/passengers/${t.userId}`}>{t.userId.slice(0, 8)}</Link>
        {t.rideId ? (
          <>
            {' '}
            · ride <Link href={`/rides/${t.rideId}`}>{t.rideId.slice(0, 8)}</Link>
          </>
        ) : null}
      </p>
      <ul className="timeline">
        {t.messages.map((m) => (
          <li key={m.id}>
            <strong>
              {m.authorStaffId ? (m.internalNote ? 'Internal note' : 'Support') : 'User'}
            </strong>{' '}
            · {when(m.createdAt)}
            <div style={m.internalNote ? { fontStyle: 'italic' } : undefined}>{m.body}</div>
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={send} style={{ marginTop: 16 }}>
        <ErrorNote error={sendError} />
        <label>
          Reply
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} required />
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
          />{' '}
          Internal note (not shown to the user)
        </label>
        <button className="btn btn-primary" type="submit">
          {internal ? 'Add note' : 'Send reply'}
        </button>
      </form>
    </>
  );
}
