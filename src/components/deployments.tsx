"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Rocket, Play, Pause, Square, Scissors, Trash2, Zap, RefreshCw } from "lucide-react";
import { usePoll, apiCall } from "@/lib/use-poll";
import { useAppStore } from "@/lib/store";
import { DeploymentRow, LegRow, OrderRow, EventRow, inr, pnlClass, timeAgo, clockTime, STATUS_STYLES } from "@/lib/client-types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface DetailPayload {
  deployment: DeploymentRow & { legs: LegRow[] };
  orders: OrderRow[];
  events: EventRow[];
}

export function Deployments() {
  const [data, refresh] = usePoll<{ deployments: DeploymentRow[] }>("/api/deployments", 3000);
  const { setTab, setDetailId, detailId } = useAppStore();
  const { toast } = useToast();

  const act = async (id: string, action: string) => {
    try {
      await apiCall(`/api/deployments/${id}/action`, "POST", { action });
      toast({ title: `Deployment ${action === "flatten" ? "squared off" : `${action}ed`}` });
      refresh();
    } catch (e) {
      toast({ title: `Action failed`, description: (e as Error).message, variant: "destructive" });
    }
  };

  const del = async (id: string) => {
    try {
      await apiCall(`/api/deployments/${id}`, "DELETE");
      toast({ title: "Deployment deleted" });
      refresh();
    } catch (e) {
      toast({ title: "Could not delete", description: (e as Error).message, variant: "destructive" });
    }
  };

  const list = data?.deployments ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Strategy Manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">Start, pause, square-off and monitor your algo deployments.</p>
        </div>
        <Button onClick={() => setTab("strategies")}><Zap className="mr-1.5 h-4 w-4" />New Deployment</Button>
      </div>

      {!data ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-accent" />)}</div>
      ) : list.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Rocket className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No deployments yet. Configure a strategy from the marketplace.</p>
          <Button size="sm" onClick={() => setTab("strategies")}>Browse Strategies</Button>
        </CardContent></Card>
      ) : (
        <>
          {/* desktop table */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Instrument / Expiry</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lots</TableHead>
                  <TableHead className="text-right">P&amp;L (MTM)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <button className="text-left font-medium hover:underline" onClick={() => setDetailId(d.id)}>{d.name}</button>
                      <div className="text-xs text-muted-foreground">{strategyLabel(d.strategyType)} · entry {d.entryTime} → {d.squareOffTime}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{d.instrument}</div>
                      <div className="text-xs text-muted-foreground">{d.expiryMode === "NEXT" ? "Next" : "Nearest"} exp{d.expiryDate ? ` · ${d.expiryDate}` : ""}</div>
                    </TableCell>
                    <TableCell><ModeChip mode={d.mode} /></TableCell>
                    <TableCell><span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[d.status] ?? STATUS_STYLES.STOPPED)}>{d.status}</span></TableCell>
                    <TableCell className="tabular-nums">{d.lots}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", pnlClass(d.totalPnl))}>
                      {inr(d.totalPnl, { sign: true })}
                      <div className="text-xs font-normal text-muted-foreground">realized {inr(d.realizedPnl, { sign: true })}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {d.status === "STOPPED" || d.status === "COMPLETED" || d.status === "KILLED" || d.status === "ERROR" ? (
                          <Button size="icon" variant="outline" title="Start" onClick={() => act(d.id, "start")}><Play className="h-3.5 w-3.5" /></Button>
                        ) : d.status === "RUNNING" ? (
                          <Button size="icon" variant="outline" title="Pause" onClick={() => act(d.id, "pause")}><Pause className="h-3.5 w-3.5" /></Button>
                        ) : (
                          <Button size="icon" variant="outline" title="Resume" onClick={() => act(d.id, "resume")}><Play className="h-3.5 w-3.5" /></Button>
                        )}
                        {["RUNNING", "PAUSED"].includes(d.status) && (
                          <Button size="icon" variant="outline" title={d.openLegs ? "Stop & square off" : "Stop"} onClick={() => act(d.id, "stop")}><Square className="h-3.5 w-3.5" /></Button>
                        )}
                        {d.openLegs ? (
                          <Button size="icon" variant="outline" title="Square off only" onClick={() => act(d.id, "flatten")}><Scissors className="h-3.5 w-3.5" /></Button>
                        ) : null}
                        {!["RUNNING", "PAUSED"].includes(d.status) && (
                          <Button size="icon" variant="outline" title="Delete" onClick={() => del(d.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* mobile cards */}
          <div className="space-y-3 md:hidden">
            {list.map((d) => (
              <Card key={d.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <button className="text-left font-medium hover:underline" onClick={() => setDetailId(d.id)}>{d.name}</button>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[d.status] ?? "")}>{d.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{d.instrument} · {strategyLabel(d.strategyType)} · {d.lots} lot(s) · <ModeChip mode={d.mode} /></div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={cn("text-lg font-semibold tabular-nums", pnlClass(d.totalPnl))}>{inr(d.totalPnl, { sign: true })}</span>
                    <div className="flex gap-1.5">
                      {["STOPPED", "COMPLETED", "KILLED", "ERROR"].includes(d.status)
                        ? <Button size="sm" variant="outline" onClick={() => act(d.id, "start")}><Play className="h-3.5 w-3.5" /></Button>
                        : d.status === "RUNNING"
                          ? <Button size="sm" variant="outline" onClick={() => act(d.id, "pause")}><Pause className="h-3.5 w-3.5" /></Button>
                          : <Button size="sm" variant="outline" onClick={() => act(d.id, "resume")}><Play className="h-3.5 w-3.5" /></Button>}
                      {["RUNNING", "PAUSED"].includes(d.status) && <Button size="sm" variant="outline" onClick={() => act(d.id, "stop")}><Square className="h-3.5 w-3.5" /></Button>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <DetailSheet onAction={act} onRefresh={refresh} />
    </div>
  );
}

function DetailSheet({ onAction, onRefresh }: { onAction: (id: string, action: string) => void; onRefresh: () => void }) {
  const { detailId, setDetailId } = useAppStore();
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [tick, setTick] = useState(0);

  const enabled = !!detailId;
  const [data] = usePoll<DetailPayload>(detailId ? `/api/deployments/${detailId}` : "/api/overview", 3000, enabled);

  // keep local copy synced
  if (data && data.deployment.id !== detail?.deployment.id) setDetail(data);
  if (data && detail && data.deployment.id === detail.deployment.id) {
    if (JSON.stringify(data) !== JSON.stringify(detail)) setDetail(data);
  }

  const close = () => { setDetailId(null); setDetail(null); onRefresh(); };

  const d = detail?.deployment;

  return (
    <Sheet open={enabled} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {d ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {d.name}
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[d.status] ?? "")}>{d.status}</span>
                <ModeChip mode={d.mode} />
              </SheetTitle>
              <p className="text-sm text-muted-foreground">{strategyLabel(d.strategyType)} · {d.instrument} · {d.expiryMode === "NEXT" ? "Next" : "Nearest"} expiry{d.expiryDate ? ` (${d.expiryDate})` : ""} · {d.lots} lot(s)</p>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Total P&L" value={inr(d.totalPnl, { sign: true })} className={pnlClass(d.totalPnl)} />
              <Stat label="Realized" value={inr(d.realizedPnl, { sign: true })} className={pnlClass(d.realizedPnl)} />
              <Stat label="MTM open" value={inr(d.unrealized, { sign: true })} className={pnlClass(d.unrealized)} />
              <Stat label="Capital" value={inr(d.capital)} />
              <Stat label="Entry" value={d.entryTime} />
              <Stat label="Square-off" value={d.squareOffTime} />
              <Stat label="Leg SL" value={`${d.legSlPct}%`} />
              <Stat label="Target" value={d.targetProfit ? inr(d.targetProfit) : "—"} />
            </div>
            {d.statusNote && <p className="mt-3 rounded-md bg-accent px-3 py-2 text-xs">{d.statusNote}</p>}

            <h3 className="mb-2 mt-5 text-sm font-semibold">Legs</h3>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">LTP</TableHead>
                    <TableHead className="text-right">SL</TableHead>
                    <TableHead className="text-right">P&amp;L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(d.legs ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No legs yet — engine enters at {d.entryTime} IST.</TableCell></TableRow>
                  )}
                  {(d.legs ?? []).map((l) => {
                    const pnl = l.status === "OPEN"
                      ? (l.side === "SELL" ? -1 : 1) * ((l.ltp ?? 0) - (l.entryPrice ?? 0)) * l.qty
                      : l.realizedPnl;
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <div className="font-mono text-xs font-medium">{l.symbol}</div>
                          <div className={cn("text-[10px] uppercase", l.status === "OPEN" ? "text-emerald-600" : "text-muted-foreground")}>
                            {l.status.replace("CLOSED_", "closed · ").replace("OPEN", "open")}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant={l.side === "SELL" ? "destructive" : "default"} className={cn("text-[10px]", l.side === "BUY" && "bg-emerald-600")}>{l.side}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{l.entryPrice?.toFixed(2) ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{(l.ltp ?? (l.exitPrice || l.entryPrice))?.toFixed(2) ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.slPrice?.toFixed(2) ?? "—"}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", pnlClass(pnl))}>{inr(pnl, { sign: true })}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <h3 className="mb-2 mt-5 text-sm font-semibold">Orders</h3>
            <div className="max-h-60 space-y-1.5 overflow-y-auto rounded-lg border p-3">
              {(detail?.orders ?? []).length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
              {(detail?.orders ?? []).map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className={cn("font-semibold", o.side === "B" ? "text-emerald-600" : "text-rose-600")}>{o.side === "B" ? "BUY" : "SELL"}</span>{" "}
                    <span className="font-mono">{o.tsym}</span>{" "}
                    <span className="text-muted-foreground">× {o.qty}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">@ ₹{o.price.toFixed(2)}</span>
                    <Badge variant={o.status === "FILLED" ? "secondary" : "destructive"} className="text-[10px]">{o.status}</Badge>
                    <span className="text-muted-foreground">{clockTime(o.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="mb-2 mt-5 text-sm font-semibold">Events</h3>
            <div className="max-h-60 space-y-2 overflow-y-auto rounded-lg border p-3">
              {(detail?.events ?? []).length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
              {(detail?.events ?? []).map((e) => (
                <div key={e.id} className="text-xs">
                  <span className={cn("mr-1.5 font-semibold", e.level === "ERROR" ? "text-rose-600" : e.level === "WARN" ? "text-amber-600" : e.level === "TRADE" ? "text-emerald-600" : "")}>{e.type}</span>
                  {e.message}
                  <span className="ml-1 text-muted-foreground">· {timeAgo(e.createdAt)}</span>
                </div>
              ))}
            </div>

            <Separator className="my-5" />
            <div className="flex flex-wrap gap-2 pb-4">
              {["STOPPED", "COMPLETED", "KILLED", "ERROR"].includes(d.status) && (
                <Button size="sm" onClick={() => onAction(d.id, "start")}><Play className="mr-1 h-3.5 w-3.5" />Start</Button>
              )}
              {d.status === "RUNNING" && <Button size="sm" variant="outline" onClick={() => onAction(d.id, "pause")}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button>}
              {d.status === "PAUSED" && <Button size="sm" onClick={() => onAction(d.id, "resume")}><Play className="mr-1 h-3.5 w-3.5" />Resume</Button>}
              {["RUNNING", "PAUSED"].includes(d.status) && (
                <Button size="sm" variant="outline" onClick={() => onAction(d.id, "stop")}><Square className="mr-1 h-3.5 w-3.5" />Stop</Button>
              )}
              {d.legs?.some((l) => l.status === "OPEN") && (
                <Button size="sm" variant="outline" onClick={() => onAction(d.id, "flatten")}><Scissors className="mr-1 h-3.5 w-3.5" />Square off</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setTick(tick + 1)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button>
            </div>
          </>
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading deployment…</div>
        )}
        {!d && <SheetTitle className="sr-only">Deployment details</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className={cn("mt-0.5 block font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

export function ModeChip({ mode }: { mode: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px]", mode === "LIVE" ? "border-rose-300 text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
      {mode}
    </Badge>
  );
}

export function strategyLabel(id: string): string {
  return id.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
