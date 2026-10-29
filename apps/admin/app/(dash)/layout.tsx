'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { useAdmin } from '@/lib/client';
import { hasRole, MeContext, StaffMe } from '@/lib/staff';

/** Navigation shows only what the staff member's roles allow; the API enforces it regardless. */
const NAV: { href: string; label: string; roles: string[] }[] = [
  { href: '/', label: 'Overview', roles: [] },
  { href: '/incidents', label: 'Safety incidents', roles: ['SAFETY', 'OPERATIONS'] },
  { href: '/rides', label: 'Rides', roles: ['OPERATIONS', 'SUPPORT', 'SAFETY'] },
  { href: '/drivers', label: 'Drivers', roles: ['OPERATIONS', 'SUPPORT', 'SAFETY'] },
  { href: '/passengers', label: 'Passengers', roles: ['OPERATIONS', 'SUPPORT', 'SAFETY'] },
  { href: '/tickets', label: 'Support', roles: ['SUPPORT', 'SAFETY', 'OPERATIONS'] },
  { href: '/pricing', label: 'Pricing & zones', roles: ['OPERATIONS', 'FINANCE'] },
  { href: '/finance', label: 'Finance', roles: ['FINANCE'] },
  { href: '/staff', label: 'Staff', roles: ['SUPER_ADMIN'] },
  { href: '/audit', label: 'Audit log', roles: ['SUPER_ADMIN'] },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { data: me } = useAdmin<StaffMe>('me');
  const pathname = usePathname();

  async function signOut() {
    await fetch('/api/session/logout', { method: 'POST', headers: { 'x-saheli-csrf': '1' } });
    window.location.href = '/login';
  }

  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        <nav className="side" aria-label="Main">
          <div className="brand">Saheli Admin</div>
          {NAV.filter((n) => !n.roles.length || hasRole(me, ...n.roles)).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={
                (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href))
                  ? 'page'
                  : undefined
              }
            >
              {n.label}
            </Link>
          ))}
          <div style={{ marginTop: 24 }} className="small muted">
            {me ? `${me.fullName} · ${me.roles.join(', ').toLowerCase()}` : ''}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 8 }}
            onClick={signOut}
          >
            Sign out
          </button>
        </nav>
        <main>{me ? children : <p className="muted">Loading…</p>}</main>
      </div>
    </MeContext.Provider>
  );
}
