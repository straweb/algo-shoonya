"use client";

import { useTheme } from "next-themes";
import { ChartCandlestick, LayoutDashboard, Zap, Rocket, ListOrdered, Settings, Sun, Moon, RadioTower, WifiOff, FlaskConical, Radar } from "lucide-react";
import { useAppStore, TabId } from "@/lib/store";
import { cn } from "@/lib/utils";
import { usePoll } from "@/lib/use-poll";
import type { OverviewData } from "@/lib/client-types";
import { Button } from "@/components/ui/button";

const TABS: Array<{ id: TabId; label: string; icon: typeof Zap }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "strategies", label: "Strategies", icon: Zap },
  { id: "backtest", label: "Backtest", icon: FlaskConical },
  { id: "scanner", label: "Scanner", icon: Radar },
  { id: "deployments", label: "Deployments", icon: Rocket },
  { id: "orders", label: "Orders", icon: ListOrdered },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { tab, setTab } = useAppStore();
  const { theme, setTheme } = useTheme();
  const [data] = usePoll<OverviewData>("/api/overview", 5000);

  const brokerOk = data?.brokerStatus?.status === "CONNECTED";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-14 items-center gap-3">
            <button onClick={() => setTab("dashboard")} className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ChartCandlestick className="h-4.5 w-4.5" />
              </span>
              <span className="text-base">Shoonya<span className="text-emerald-600 dark:text-emerald-400">Algo</span></span>
            </button>

            <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
                    tab === t.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                  )}
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs">
                <span className={cn("h-2 w-2 rounded-full", data?.market.open ? "bg-emerald-500 animate-pulse" : "bg-zinc-400")} />
                <span className="font-medium">{data?.market.open ? "Market Open" : "Market Closed"}</span>
                <span className="text-muted-foreground tabular-nums" suppressHydrationWarning>
                  {data?.market.istTime ?? "--:--"} IST
                </span>
              </div>

              <div
                className={cn(
                  "hidden sm:flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
                  brokerOk
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                    : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
                )}
                title={data?.brokerStatus.lastError ?? undefined}
              >
                {brokerOk ? <RadioTower className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {brokerOk ? `Shoonya · ${data?.brokerStatus.userId ?? ""}` : "Shoonya · Offline"}
              </div>

              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle theme"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <Sun className="h-4.5 w-4.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4.5 w-4.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>
            </div>
          </div>

          {/* mobile nav */}
          <nav className="flex gap-1 overflow-x-auto pb-2 md:hidden" aria-label="Mobile">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-medium",
                  tab === t.id ? "bg-accent text-accent-foreground" : "text-muted-foreground",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="mt-auto border-t py-4">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-muted-foreground sm:px-6">
          ShoonyaAlgo — personal index-options automation on Finvasia Shoonya (Noren API). Paper mode is simulated;
          live mode places real orders. Trading in F&O carries risk of loss.
        </div>
      </footer>
    </div>
  );
}
