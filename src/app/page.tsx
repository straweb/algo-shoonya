"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { useAppStore } from "@/lib/store";
import { Shell } from "@/components/shell";
import { Dashboard } from "@/components/dashboard";
import { Strategies } from "@/components/strategies";
import { Deployments } from "@/components/deployments";
import { OrderLog } from "@/components/orderlog";
import { SettingsView } from "@/components/settings";
import { DeployWizard } from "@/components/deploy-wizard";
import { Backtest } from "@/components/backtest";
import { Scanner } from "@/components/scanner";
import { Toaster } from "@/components/ui/toaster";

function Views() {
  const { tab } = useAppStore();
  switch (tab) {
    case "strategies": return <Strategies />;
    case "backtest": return <Backtest />;
    case "scanner": return <Scanner />;
    case "deployments": return <Deployments />;
    case "orders": return <OrderLog />;
    case "settings": return <SettingsView />;
    default: return <Dashboard />;
  }
}

export default function Home() {
  // keep the engine ticking even when idle
  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/overview", { cache: "no-store" }).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <Shell>
        <Views />
        <DeployWizard />
      </Shell>
      <Toaster />
    </ThemeProvider>
  );
}
