'use client';

import { useState } from 'react';
import { ActionButton, Badge, ErrorNote, PageTitle, Table } from '@/components/ui';
import { istDaysAgo, istToday, rupees, useAdmin, when } from '@/lib/client';

interface Refund {
  id: string;
  paymentId: string;
  amountPaise: number;
  status: string;
  reason: string;
  requestedBy: string | null;
  createdAt: string;
}

interface Balance {
  driver_id: string;
  name: string | null;
  net_paise: string;
}

interface Payout {
  id: string;
  driverId: string;
  amountPaise: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  providerReference: string | null;
  createdAt: string;
}

export default function Finance() {
  const refunds = useAdmin<Refund[]>('refunds');
  const balances = useAdmin<Balance[]>('payouts/balances');
  const payouts = useAdmin<Payout[]>('payouts');
  const [from, setFrom] = useState(istDaysAgo(6));
  const [to, setTo] = useState(istToday());
  const reloadPayouts = () => {
    void balances.reload();
    void payouts.reload();
  };

  return (
    <>
      <PageTitle>Finance</PageTitle>

      <h2>Refund requests</h2>
      <p className="muted small">
        Refunds need approval from a different staff member than the one who requested them.
      </p>
      <ErrorNote error={refunds.error} />
      <Table
        rows={refunds.data}
        empty="No refunds."
        columns={[
          { header: 'Refund', render: (r) => r.id.slice(0, 8) },
          { header: 'Amount', render: (r) => rupees(r.amountPaise) },
          { header: 'Reason', render: (r) => r.reason },
          { header: 'Status', render: (r) => <Badge value={r.status} /> },
          { header: 'Requested', render: (r) => when(r.createdAt) },
          {
            header: '',
            render: (r) =>
              r.status === 'REQUESTED' ? (
                <span className="row">
                  <ActionButton
                    label="Approve"
                    path={`refunds/${r.id}/decision`}
                    body={{ approve: true }}
                    confirmText="Send this refund to the passenger?"
                    onDone={refunds.reload}
                  />
                  <ActionButton
                    label="Reject"
                    variant="secondary"
                    path={`refunds/${r.id}/decision`}
                    body={{ approve: false }}
                    confirmText="Reject this refund?"
                    onDone={refunds.reload}
                  />
                </span>
              ) : null,
          },
        ]}
      />

      <h2>Driver balances</h2>
      <p className="muted small">
        Positive: Saheli owes the driver. Negative: the driver holds cash owed to Saheli.
      </p>
      <ErrorNote error={balances.error} />
      <Table
        rows={balances.data}
        empty="All balances are settled."
        columns={[
          { header: 'Driver', render: (b) => b.name ?? b.driver_id.slice(0, 8) },
          { header: 'Net', render: (b) => rupees(Number(b.net_paise)) },
          {
            header: '',
            render: (b) =>
              Number(b.net_paise) > 0 ? (
                <ActionButton
                  label="Create payout"
                  path={`drivers/${b.driver_id}/payouts`}
                  body={{ periodStart: from, periodEnd: to }}
                  confirmText={`Pay out ${rupees(Number(b.net_paise))}?`}
                  onDone={reloadPayouts}
                />
              ) : null,
          },
        ]}
      />

      <h2>Payouts</h2>
      <ErrorNote error={payouts.error} />
      <Table
        rows={payouts.data}
        empty="No payouts yet."
        columns={[
          { header: 'Payout', render: (p) => p.id.slice(0, 8) },
          { header: 'Amount', render: (p) => rupees(p.amountPaise) },
          { header: 'Period', render: (p) => `${p.periodStart} → ${p.periodEnd}` },
          { header: 'Status', render: (p) => <Badge value={p.status} /> },
          { header: 'Reference', render: (p) => p.providerReference ?? '—' },
          {
            header: '',
            render: (p) =>
              p.status === 'PENDING' || p.status === 'PROCESSING' ? (
                <span className="row">
                  <ActionButton
                    label="Mark paid"
                    path={`payouts/${p.id}/settle`}
                    body={{ paid: true }}
                    reasonPrompt="Bank reference (UTR)"
                    reasonField="reference"
                    onDone={reloadPayouts}
                  />
                  <ActionButton
                    label="Failed"
                    variant="secondary"
                    path={`payouts/${p.id}/settle`}
                    body={{ paid: false }}
                    reasonPrompt="Why did the transfer fail?"
                    onDone={reloadPayouts}
                  />
                </span>
              ) : null,
          },
        ]}
      />

      <h2>Reports</h2>
      <div className="row">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <a
          className="btn btn-secondary"
          href={`/api/admin/reports/rides.csv?from=${from}&to=${to}`}
        >
          Download rides CSV
        </a>
      </div>
      <p className="muted small">
        Exports contain no names or phone numbers. Each export is logged.
      </p>
    </>
  );
}
