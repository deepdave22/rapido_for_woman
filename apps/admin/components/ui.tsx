'use client';

import Link from 'next/link';
import { ReactNode, useState } from 'react';
import { adminApi } from '@/lib/client';

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-title">
      <h1>{children}</h1>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className="note error" role="alert">
      {error}
    </p>
  ) : null;
}

export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge badge-${value.toLowerCase()}`}>
      {value.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

/** App-store reviewer accounts (docs/MOBILE_RELEASE.md): sandboxed test users, not real people. */
export function ReviewTag({ show }: { show: boolean | null | undefined }) {
  return show ? (
    <span className="badge badge-review" title="App-store reviewer test account">
      review account
    </span>
  ) : null;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="muted">{hint}</div> : null}
    </div>
  );
}

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
}

export function Table<T>({
  rows,
  columns,
  rowHref,
  empty = 'Nothing here.',
}: {
  rows: T[] | null;
  columns: Column<T>[];
  rowHref?: (row: T) => string;
  empty?: string;
}) {
  if (!rows) return <p className="muted">Loading…</p>;
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c, j) => (
                <td key={c.header}>
                  {j === 0 && rowHref ? (
                    <Link href={rowHref(row)}>{c.render(row)}</Link>
                  ) : (
                    c.render(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A button that calls the API, optionally asking for a reason first, and
 * reports the result inline. Used for every staff action.
 */
export function ActionButton({
  label,
  path,
  body,
  method = 'POST',
  reasonPrompt,
  reasonField = 'reason',
  confirmText,
  variant = 'primary',
  onDone,
}: {
  label: string;
  path: string;
  body?: Record<string, unknown>;
  method?: 'POST' | 'PATCH' | 'DELETE';
  reasonPrompt?: string;
  reasonField?: string;
  confirmText?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    let payload = body;
    if (reasonPrompt) {
      const reason = window.prompt(reasonPrompt);
      if (!reason) return;
      payload = { ...body, [reasonField]: reason };
    } else if (confirmText && !window.confirm(confirmText)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi(path, { method, body: payload ?? {} });
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="action">
      <button type="button" className={`btn btn-${variant}`} onClick={run} disabled={busy}>
        {busy ? '…' : label}
      </button>
      {error ? <span className="error small">{error}</span> : null}
    </span>
  );
}
