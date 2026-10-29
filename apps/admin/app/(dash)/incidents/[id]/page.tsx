'use client';

import Link from 'next/link';
import { use } from 'react';
import { ActionButton, Badge, ErrorNote, PageTitle } from '@/components/ui';
import { useAdmin, when } from '@/lib/client';

interface IncidentDetail {
  id: string;
  type: string;
  severity: string;
  status: string;
  rideId: string | null;
  description: string | null;
  location: { lat: number; lng: number } | null;
  reporter: { id: string; name: string | null; phone: string };
  reporterRole: string;
  createdAt: string;
  acknowledgedAt: string | null;
  responseInitiatedAt: string | null;
  resolvedAt: string | null;
  resolutionSummary: string | null;
  timeline: {
    id: number;
    action: string;
    note: string | null;
    staffUserId: string | null;
    createdAt: string;
  }[];
}

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: i, error, reload } = useAdmin<IncidentDetail>(`incidents/${id}`);
  if (!i) return <ErrorNote error={error} />;

  return (
    <>
      <PageTitle
        actions={
          <>
            {i.status === 'OPEN' ? (
              <ActionButton
                label="Acknowledge"
                path={`incidents/${id}/status/acknowledge`}
                onDone={reload}
              />
            ) : null}
            {i.status === 'OPEN' || i.status === 'ACKNOWLEDGED' ? (
              <ActionButton
                label="Record response"
                variant="danger"
                path={`incidents/${id}/status/respond`}
                reasonPrompt="What action was actually taken?"
                reasonField="note"
                onDone={reload}
              />
            ) : null}
            {i.status === 'ACKNOWLEDGED' || i.status === 'RESPONDING' ? (
              <ActionButton
                label="Resolve"
                variant="secondary"
                path={`incidents/${id}/status/resolve`}
                reasonPrompt="Resolution summary"
                reasonField="note"
                onDone={reload}
              />
            ) : null}
            {i.status === 'RESOLVED' ? (
              <ActionButton
                label="Close"
                variant="secondary"
                path={`incidents/${id}/status/close`}
                onDone={reload}
              />
            ) : null}
            <ActionButton
              label="Add note"
              variant="secondary"
              path={`incidents/${id}/notes`}
              reasonPrompt="Internal note"
              reasonField="note"
              onDone={reload}
            />
          </>
        }
      >
        {i.type.replace(/_/g, ' ')} <Badge value={i.severity} /> <Badge value={i.status} />
      </PageTitle>
      <div className="grid">
        <div
          className="card"
          style={
            i.severity === 'CRITICAL' && i.status === 'OPEN'
              ? { borderColor: 'var(--danger)' }
              : undefined
          }
        >
          <dl className="kv">
            <dt>Reporter</dt>
            <dd>
              {i.reporter.name ?? '—'} ({i.reporterRole.toLowerCase()})
            </dd>
            <dt>Call back</dt>
            <dd>
              <a href={`tel:${i.reporter.phone}`}>{i.reporter.phone}</a>
            </dd>
            <dt>Ride</dt>
            <dd>
              {i.rideId ? (
                <Link href={`/rides/${i.rideId}`}>{i.rideId.slice(0, 8)}</Link>
              ) : (
                'Not on a ride'
              )}
            </dd>
            <dt>Location</dt>
            <dd>
              {i.location ? (
                <a
                  href={`https://www.google.com/maps?q=${i.location.lat},${i.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {i.location.lat.toFixed(5)}, {i.location.lng.toFixed(5)}
                </a>
              ) : (
                'Not shared'
              )}
            </dd>
          </dl>
        </div>
        <div className="card">
          <dl className="kv">
            <dt>Raised</dt>
            <dd>{when(i.createdAt)}</dd>
            <dt>Acknowledged</dt>
            <dd>{when(i.acknowledgedAt)}</dd>
            <dt>Response</dt>
            <dd>{when(i.responseInitiatedAt)}</dd>
            <dt>Resolved</dt>
            <dd>{when(i.resolvedAt)}</dd>
          </dl>
        </div>
      </div>
      {i.description ? (
        <>
          <h2>Report</h2>
          <p className="card">{i.description}</p>
        </>
      ) : null}
      <h2>Timeline</h2>
      <ul className="timeline">
        {i.timeline.map((e) => (
          <li key={e.id}>
            <strong>{e.action.replace(/_/g, ' ').toLowerCase()}</strong> · {when(e.createdAt)}
            {e.note ? <div>{e.note}</div> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
