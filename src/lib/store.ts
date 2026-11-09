"use client";

import { create } from "zustand";

export type TabId = "dashboard" | "strategies" | "backtest" | "scanner" | "deployments" | "orders" | "settings";

interface AppState {
  tab: TabId;
  setTab: (t: TabId) => void;
  wizardStrategy: string | null;
  openWizard: (strategyId: string) => void;
  closeWizard: () => void;
  detailId: string | null;
  setDetailId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tab: "dashboard",
  setTab: (t) => set({ tab: t }),
  wizardStrategy: null,
  openWizard: (s) => set({ wizardStrategy: s }),
  closeWizard: () => set({ wizardStrategy: null }),
  detailId: null,
  setDetailId: (id) => set({ detailId: id }),
}));
