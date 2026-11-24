"use client";

import { createContext, useContext } from "react";

export type Merchant = { id: string; name: string; role: string; status: string };
export type Account = { id: string; name: string; email: string; role: string; merchants: Merchant[] };
export type DashboardContextValue = { user: Account; merchant: Merchant; setMerchantId: (id: string) => void };
export const DashboardContext = createContext<DashboardContextValue | null>(null);
export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("Dashboard context is unavailable");
  return value;
}
