'use client';

import { FormEvent, useMemo, useState } from 'react';
import { ActionButton, ErrorNote, PageTitle, Table } from '@/components/ui';
import { adminApi, rupees, useAdmin, when } from '@/lib/client';
import { hasRole, useStaff } from '@/lib/staff';

interface Rule {
  id: string;
  zoneId: string;
  categoryCode: string;
  version: number;
  effectiveFrom: string;
  baseFarePaise: number;
  includedDistanceMeters: number;
  perKmPaise: number;
  perMinutePaise: number;
  minimumFarePaise: number;
  bookingFeePaise: number;
  taxRateBps: number;
  waitingFreeSeconds: number;
  waitingPerMinutePaise: number;
  commissionRateBps: number;
  maxSurgeBps: number;
  cancellationFeePaise: number;
  cancellationFreeWindowSeconds: number;
  cancellationArrivedGraceSeconds: number;
  changeNote: string | null;
}

interface Zone {
  id: string;
  city: string;
  name: string;
  active: boolean;
}

const FIELDS: { key: keyof Rule; label: string }[] = [
  { key: 'baseFarePaise', label: 'Base fare (paise)' },
  { key: 'includedDistanceMeters', label: 'Included distance (m)' },
  { key: 'perKmPaise', label: 'Per km (paise)' },
  { key: 'perMinutePaise', label: 'Per minute (paise)' },
  { key: 'minimumFarePaise', label: 'Minimum fare (paise)' },
  { key: 'bookingFeePaise', label: 'Booking fee (paise)' },
  { key: 'taxRateBps', label: 'Tax (bps)' },
  { key: 'commissionRateBps', label: 'Commission (bps)' },
  { key: 'waitingFreeSeconds', label: 'Free waiting (s)' },
  { key: 'waitingPerMinutePaise', label: 'Waiting per minute (paise)' },
  { key: 'maxSurgeBps', label: 'Max surge (bps, 10000 = none)' },
  { key: 'cancellationFeePaise', label: 'Cancellation fee (paise)' },
  { key: 'cancellationFreeWindowSeconds', label: 'Free cancel window (s)' },
  { key: 'cancellationArrivedGraceSeconds', label: 'Grace after arrival (s)' },
];

export default function Pricing() {
  const me = useStaff();
  const zones = useAdmin<Zone[]>('zones');
  const rules = useAdmin<Rule[]>('pricing');
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Latest version per zone + category.
  const current = useMemo(() => {
    const seen = new Set<string>();
    return (rules.data ?? []).filter((r) => {
      const k = `${r.zoneId}:${r.categoryCode}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [rules.data]);

  function startEdit(r: Rule) {
    setEditing(r);
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(r[f.key])])));
    setError(null);
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const changeNote = form.changeNote ?? '';
    try {
      await adminApi('pricing', {
        method: 'POST',
        body: {
          zoneId: editing.zoneId,
          categoryCode: editing.categoryCode,
          changeNote,
          ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])])),
        },
      });
      setEditing(null);
      await rules.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  const zoneName = (id: string) => zones.data?.find((z) => z.id === id)?.city ?? id.slice(0, 8);

  return (
    <>
      <PageTitle>Pricing & zones</PageTitle>
      <p className="muted">
        Publishing creates a new version. Quotes already shown to passengers keep the price they
        were given.
      </p>
      <h2>Zones</h2>
      <ErrorNote error={zones.error} />
      <Table
        rows={zones.data}
        columns={[
          { header: 'City', render: (z) => z.city },
          { header: 'Name', render: (z) => z.name },
          { header: 'Active', render: (z) => (z.active ? 'Yes' : 'No') },
          {
            header: '',
            render: (z) =>
              hasRole(me, 'OPERATIONS') ? (
                <ActionButton
                  label={z.active ? 'Deactivate' : 'Activate'}
                  variant="secondary"
                  method="PATCH"
                  path={`zones/${z.id}`}
                  body={{ active: !z.active }}
                  confirmText={
                    z.active
                      ? 'New bookings in this zone will be refused. Continue?'
                      : 'Open this zone for bookings?'
                  }
                  onDone={zones.reload}
                />
              ) : null,
          },
        ]}
      />
      <h2>Current prices</h2>
      <ErrorNote error={rules.error} />
      <Table
        rows={current}
        columns={[
          { header: 'Zone', render: (r) => zoneName(r.zoneId) },
          { header: 'Type', render: (r) => r.categoryCode },
          { header: 'Version', render: (r) => `v${r.version} · from ${when(r.effectiveFrom)}` },
          {
            header: 'Base / km / min',
            render: (r) =>
              `${rupees(r.baseFarePaise)} / ${rupees(r.perKmPaise)} / ${rupees(r.perMinutePaise)}`,
          },
          { header: 'Minimum', render: (r) => rupees(r.minimumFarePaise) },
          { header: 'Commission', render: (r) => `${r.commissionRateBps / 100}%` },
          {
            header: '',
            render: (r) =>
              hasRole(me, 'FINANCE') ? (
                <button type="button" className="btn btn-secondary" onClick={() => startEdit(r)}>
                  New version
                </button>
              ) : null,
          },
        ]}
      />
      {editing ? (
        <form className="card" onSubmit={publish} style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>
            New version for {zoneName(editing.zoneId)} · {editing.categoryCode}
          </h2>
          <ErrorNote error={error} />
          <div className="form-grid">
            {FIELDS.map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type="number"
                  min={0}
                  required
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label style={{ marginTop: 12 }}>
            Reason for change (recorded)
            <input
              required
              minLength={5}
              value={form.changeNote ?? ''}
              onChange={(e) => setForm({ ...form, changeNote: e.target.value })}
            />
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" type="submit">
              Publish
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
