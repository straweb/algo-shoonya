"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { IndianRupee, Wallet, Rocket, ListOrdered, Flame, Activity, ArrowRight } from "lucide-react";
import { usePoll } from "@/lib/use-poll";
import { useAppStore } from "@/lib/store";
import { OverviewData, inr, pnlClass, timeAgo, STATUS_STYLES } from "@/lib/client-types";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/sparkline";
import { apiCall } from "@/lib/use-poll";
import { useToast } from "@/hooks/use-toast";

const LEVEL_COLOR: Record<string, string> = {
  INFO: "bg-zinc-400",
  TRADE: "bg-emerald-500",
  WARN: "bg-amber-500",
  ERROR: "bg-rose-500",
};

const INDEX_ORDER = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];
const BASE_SPOTS: Record<string, number> = { NIFTY: 25900, BANKNIFTY: 57500, FINNIFTY: 26500, MIDCPNIFTY: 13200, SENSEX: 85500, BANKEX: 64500 };

export function Dashboard() {
  const [data, refresh] = usePoll<OverviewData>("/api/overview", 3000);
  const { setTab, setDetailId } = useAppStore();
  const { toast } = useToast();

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse"><CardContent className="h-24" /></Card>
        ))}
      </div>
    );
  }

  const { totals, killSwitch, market } = data;
  const active = data.deployments.filter((d) => ["RUNNING", "PAUSED"].includes(d.status));

  const act = async (id: string, action: string) => {
    try {
      await apiCall(`/api/deployments/${id}/action`, "POST", { action });
      toast({ title: `Deployment ${action}ed` });
      refresh();
    } catch (e) {
      toast({ title: `Could not ${action}`, description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* market strip */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={market.open ? "default" : "secondary"} className={market.open ? "bg-emerald-600" : market.sim ? "bg-amber-500 text-white" : ""}>
          <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full", market.open ? "bg-white animate-pulse" : market.sim ? "bg-white" : "bg-zinc-400")} />
          {market.open ? "Market Open" : market.sim ? "Simulated Session" : "Market Closed"}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">{market.istDate} · {market.istTime} IST</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {INDEX_ORDER.filter((k) => data.paperSpots[k] !== undefined).map((k) => {
            const px = data.paperSpots[k];
            const chg = ((px - BASE_SPOTS[k]) / BASE_SPOTS[k]) * 100;
            return (
              <span key={k} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
                <span className="font-medium">{k}</span>
                <span className="tabular-nums">{px.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                <span className={cn("tabular-nums", pnlClass(chg))}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
              </span>
            );
          })}
          <span className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-1 text-[10px] font-medium uppercase text-zinc-500 dark:bg-zinc-900">
            simulated
          </span>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Wallet className="h-4 w-4" /> Capital Deployed</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{inr(totals.allocated)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{active.length} active deployment{active.length === 1 ? "" : "s"} · paper capital {inr(data.settings?.paperCapital ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><IndianRupee className="h-4 w-4" /> Today&apos;s P&amp;L</CardTitle></CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-semibold tabular-nums", pnlClass(totals.totalPnl))}>{inr(totals.totalPnl, { sign: true })}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              realized <span className={pnlClass(totals.realized)}>{inr(totals.realized, { sign: true })}</span> · MTM{" "}
              <span className={pnlClass(totals.unrealized)}>{inr(totals.unrealized, { sign: true })}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Rocket className="h-4 w-4" /> Deployments</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{totals.running}<span className="text-base text-muted-foreground"> running</span></div>
            <p className="mt-1 text-xs text-muted-foreground">{totals.paused} paused · {totals.total} total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><ListOrdered className="h-4 w-4" /> Orders</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{totals.ordersCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">entries + exits across all deployments</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* P&L chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4" /> Realized P&amp;L — last 24h</CardTitle>
          </CardHeader>
          <CardContent>
            <Sparkline points={data.pnlSeries} />
          </CardContent>
        </Card>

        {/* kill switch */}
        <Card className={cn(killSwitch.lossUsed >= 80 && "border-rose-300 dark:border-rose-900")}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium"><Flame className="h-4 w-4 text-rose-500" /> Day Max Loss — Kill Switch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular-nums">{inr(killSwitch.dayMaxLoss)}</span>
              <span className={cn("text-xs font-medium", killSwitch.lossUsed > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                {killSwitch.lossUsed.toFixed(0)}% used
              </span>
            </div>
            <Progress value={killSwitch.lossUsed} className="h-2" />
            <p className="text-xs text-muted-foreground">
              When combined P&amp;L across all running deployments hits <span className="font-medium text-foreground">-₹{killSwitch.dayMaxLoss.toLocaleString("en-IN")}</span>, the engine force-closes every position and stops all deployments. Change in <button className="underline underline-offset-2" onClick={() => setTab("settings")}>Settings</button>.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* active deployments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Deployments</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setTab("deployments")}>
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {active.length === 0 && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No deployments running. Pick a strategy to get started.
                <div className="mt-3"><Button size="sm" onClick={() => setTab("strategies")}>Browse Strategies</Button></div>
              </div>
            )}
            {active.slice(0, 5).map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", d.status === "RUNNING" ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                <button className="min-w-0 flex-1 text-left" onClick={() => { setDetailId(d.id); setTab("deployments"); }}>
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{d.instrument} · {d.lots} lot{d.lots > 1 ? "s" : ""} · entry {d.entryTime} · {d.mode}</div>
                </button>
                <span className={cn("text-sm font-semibold tabular-nums", pnlClass(d.totalPnl))}>{inr(d.totalPnl, { sign: true })}</span>
                <Button size="sm" variant="outline" onClick={() => act(d.id, "stop")}>Stop</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* events */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Activity Feed</CardTitle></CardHeader>
          <CardContent className="max-h-80 space-y-2.5 overflow-y-auto pr-2">
            {data.events.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
            {data.events.map((e) => (
              <div key={e.id} className="flex gap-2.5 text-sm">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", LEVEL_COLOR[e.level] ?? "bg-zinc-400")} />
                <div className="min-w-0">
                  <p className="leading-snug">{e.message}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.deployment?.name ? `${e.deployment.name} · ` : ""}{timeAgo(e.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
