'use client';

import { createContext, useContext } from 'react';

export interface StaffMe {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
}

export const MeContext = createContext<StaffMe | null>(null);
export const useStaff = () => useContext(MeContext);
export const hasRole = (me: StaffMe | null, ...roles: string[]) =>
  !!me && (me.roles.includes('SUPER_ADMIN') || roles.some((r) => me.roles.includes(r)));
