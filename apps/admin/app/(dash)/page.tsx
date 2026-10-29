'use client';

import { useState } from 'react';
import { ErrorNote, PageTitle, Stat } from '@/components/ui';
import { istDaysAgo, istToday, rupees, useAdmin } from '@/lib/client';

interface Metrics {
  passengers: number;
  drivers: number;
  driversByStatus: Record<string, number>;
  activeRides: number;
  driversOnline: number;
  completedRides: number;
  cancelledRides: number;
  noDriverFoundRides: number;
  grossBookingValuePaise: number;
  platformRevenuePaise: number;
  offers: { offered: number; accepted: number; acceptanceRate: number | null };
  driverCancellations: number;
  openIncidentsBySeverity: Record<string, number>;
  openTickets: number;
  zones: { city: string; name: string; active: boolean; online: number }[];
}

const RANGES = { Today: 0, '7 days': 6, '30 days': 29 } as const;

export default function Overview() {
  const [range, setRange] = useState<keyof typeof RANGES>('Today');
  const { data: m, error } = useAdmin<Metrics>(
    `metrics?from=${istDaysAgo(RANGES[range])}&to=${istToday()}`,
  );
  const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;

  return (
    <>
      <PageTitle
        actions={(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
          <button
            key={r}
            type="button"
            className={`btn ${r === range ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      >
        Overview
      </PageTitle>
      <ErrorNote error={error} />
      {m ? (
        <>
          <h2>Right now</h2>
          <div className="grid">
            <Stat label="Active rides" value={m.activeRides} />
            <Stat label="Drivers online" value={m.driversOnline} />
            <Stat
              label="Open safety incidents"
              value={Object.values(m.openIncidentsBySeverity).reduce((a, b) => a + b, 0)}
              hint={
                m.openIncidentsBySeverity.CRITICAL
                  ? `${m.openIncidentsBySeverity.CRITICAL} critical`
                  : undefined
              }
            />
            <Stat label="Open support tickets" value={m.openTickets} />
          </div>
          <h2>{range}</h2>
          <div className="grid">
            <Stat label="Completed rides" value={m.completedRides} />
            <Stat label="Cancelled" value={m.cancelledRides} />
            <Stat label="No driver found" value={m.noDriverFoundRides} />
            <Stat label="Gross booking value" value={rupees(m.grossBookingValuePaise)} />
            <Stat
              label="Platform revenue"
              value={rupees(m.platformRevenuePaise)}
              hint="From the ledger"
            />
            <Stat
              label="Offer acceptance"
              value={pct(m.offers.acceptanceRate)}
              hint={`${m.offers.accepted} of ${m.offers.offered} offers`}
            />
            <Stat label="Driver cancellations" value={m.driverCancellations} />
          </div>
          <h2>People</h2>
          <div className="grid">
            <Stat label="Passengers" value={m.passengers} />
            <Stat label="Drivers" value={m.drivers} />
            {Object.entries(m.driversByStatus).map(([s, n]) => (
              <Stat key={s} label={`Drivers: ${s.replace(/_/g, ' ').toLowerCase()}`} value={n} />
            ))}
          </div>
          <h2>Service zones</h2>
          <div className="grid">
            {m.zones.map((z) => (
              <Stat
                key={z.name}
                label={`${z.city}${z.active ? '' : ' (inactive)'}`}
                value={`${z.online} online`}
                hint={z.name}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
