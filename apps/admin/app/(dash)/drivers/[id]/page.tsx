'use client';

import { use } from 'react';
import { ActionButton, Badge, ErrorNote, PageTitle, Table } from '@/components/ui';
import { rupees, useAdmin, when } from '@/lib/client';
import { hasRole, useStaff } from '@/lib/staff';

interface DriverDetail {
  id: string;
  name: string | null;
  phone: string;
  accountStatus: string;
  status: string;
  statusReason: string | null;
  submittedAt: string | null;
  rating: number | null;
  ratingCount: number;
  vehicle: {
    registrationNumber: string;
    categoryCode: string;
    make: string;
    model: string;
    colour: string;
    status: string;
  } | null;
  documents: {
    id: string;
    type: string;
    status: string;
    mimeType: string;
    expiresOn: string | null;
    rejectionReason: string | null;
    createdAt: string;
  }[];
  checks: {
    id: string;
    check: string;
    status: string;
    provider: string | null;
    notes: string | null;
    createdAt: string;
  }[];
  verificationGaps: string[];
  rides: { completed: number; total: number };
  balance: { payablePaise: number; cashHeldPaise: number; netPaise: number };
}

const CHECKS = ['IDENTITY', 'GENDER_ELIGIBILITY', 'DRIVING_LICENCE', 'BACKGROUND'];

export default function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useStaff();
  const { data: d, error, reload } = useAdmin<DriverDetail>(`drivers/${id}`);
  const canReview = hasRole(me, 'OPERATIONS');
  if (!d) return <ErrorNote error={error} />;
  const latestCheck = (c: string) => d.checks.find((x) => x.check === c);

  return (
    <>
      <PageTitle
        actions={
          canReview ? (
            <>
              {d.status === 'PENDING_REVIEW' ? (
                <>
                  <ActionButton
                    label="Approve driver"
                    path={`drivers/${id}/decision`}
                    body={{ decision: 'APPROVE' }}
                    confirmText="Approve this driver to take rides?"
                    onDone={reload}
                  />
                  <ActionButton
                    label="Reject"
                    variant="secondary"
                    path={`drivers/${id}/decision`}
                    body={{ decision: 'REJECT' }}
                    reasonPrompt="Reason shown to the driver"
                    onDone={reload}
                  />
                </>
              ) : null}
              {d.status === 'APPROVED' ? (
                <ActionButton
                  label="Suspend"
                  variant="danger"
                  path={`drivers/${id}/decision`}
                  body={{ decision: 'SUSPEND' }}
                  reasonPrompt="Reason for suspension"
                  onDone={reload}
                />
              ) : null}
              {d.status === 'SUSPENDED' ? (
                <ActionButton
                  label="Reactivate"
                  path={`drivers/${id}/decision`}
                  body={{ decision: 'REACTIVATE' }}
                  confirmText="Reactivate this driver?"
                  onDone={reload}
                />
              ) : null}
            </>
          ) : null
        }
      >
        {d.name ?? 'Driver'} <Badge value={d.status} />
      </PageTitle>
      <ErrorNote error={error} />
      {d.statusReason ? <p className="muted">Reason: {d.statusReason}</p> : null}
      {d.status === 'PENDING_REVIEW' && d.verificationGaps.length ? (
        <p className="note error">
          Still needed before approval:{' '}
          {d.verificationGaps.join(', ').toLowerCase().replace(/_/g, ' ')}
        </p>
      ) : null}

      <div className="grid">
        <div className="card">
          <dl className="kv">
            <dt>Phone</dt>
            <dd>{d.phone}</dd>
            <dt>Account</dt>
            <dd>
              <Badge value={d.accountStatus} />
            </dd>
            <dt>Submitted</dt>
            <dd>{when(d.submittedAt)}</dd>
            <dt>Rating</dt>
            <dd>{d.rating ? `★ ${d.rating} (${d.ratingCount})` : '—'}</dd>
            <dt>Rides</dt>
            <dd>
              {d.rides.completed} completed / {d.rides.total}
            </dd>
          </dl>
        </div>
        <div className="card">
          <dl className="kv">
            <dt>Vehicle</dt>
            <dd>
              {d.vehicle ? `${d.vehicle.registrationNumber} (${d.vehicle.categoryCode})` : '—'}
            </dd>
            <dt>Details</dt>
            <dd>{d.vehicle ? `${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model}` : '—'}</dd>
            <dt>Owed to driver</dt>
            <dd>{rupees(d.balance.netPaise)}</dd>
            <dt>Cash held</dt>
            <dd>{rupees(d.balance.cashHeldPaise)}</dd>
          </dl>
        </div>
      </div>

      <h2>Documents</h2>
      <Table
        rows={d.documents}
        columns={[
          { header: 'Type', render: (x) => x.type.replace(/_/g, ' ').toLowerCase() },
          { header: 'Status', render: (x) => <Badge value={x.status} /> },
          { header: 'Expires', render: (x) => x.expiresOn ?? '—' },
          { header: 'Uploaded', render: (x) => when(x.createdAt) },
          {
            header: 'Actions',
            render: (x) =>
              canReview ? (
                <span className="row">
                  {/* Opening a document is audited. */}
                  <a
                    className="btn btn-secondary"
                    href={`/api/admin/documents/${x.id}/content`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                  {x.status === 'UPLOADED' ? (
                    <>
                      <ActionButton
                        label="Approve"
                        path={`documents/${x.id}/review`}
                        body={{ approve: true }}
                        onDone={reload}
                      />
                      <ActionButton
                        label="Reject"
                        variant="secondary"
                        path={`documents/${x.id}/review`}
                        body={{ approve: false }}
                        reasonPrompt="What is wrong with this document?"
                        onDone={reload}
                      />
                    </>
                  ) : null}
                </span>
              ) : (
                <span className="muted small">Operations only</span>
              ),
          },
        ]}
      />

      <h2>Verification checks</h2>
      <Table
        rows={CHECKS.map((c) => ({ check: c, latest: latestCheck(c) }))}
        columns={[
          { header: 'Check', render: (x) => x.check.replace(/_/g, ' ').toLowerCase() },
          { header: 'Status', render: (x) => <Badge value={x.latest?.status ?? 'NOT_STARTED'} /> },
          { header: 'Source', render: (x) => x.latest?.provider ?? '—' },
          { header: 'Notes', render: (x) => x.latest?.notes ?? '—' },
          {
            header: 'Record result',
            render: (x) =>
              canReview ? (
                <span className="row">
                  <ActionButton
                    label="Passed"
                    path={`drivers/${id}/checks/${x.check}`}
                    body={{ status: 'PASSED', provider: 'manual-review' }}
                    reasonPrompt="Evidence / reference checked"
                    reasonField="notes"
                    onDone={reload}
                  />
                  <ActionButton
                    label="Failed"
                    variant="secondary"
                    path={`drivers/${id}/checks/${x.check}`}
                    body={{ status: 'FAILED', provider: 'manual-review' }}
                    reasonPrompt="Why did this check fail?"
                    reasonField="notes"
                    onDone={reload}
                  />
                </span>
              ) : null,
          },
        ]}
      />
    </>
  );
}
