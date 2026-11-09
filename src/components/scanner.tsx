"use client";

import { useEffect, useMemo, useState } from "react";
import { Radar, RotateCcw, Save, Search, Zap, CircleDollarSign, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiCall, usePoll } from "@/lib/use-poll";
import { inr, pnlClass, timeAgo } from "@/lib/client-types";
import { STOCK_UNIVERSE } from "@/lib/stocks";
import { cn } from "@/lib/utils";

interface ScanTradeRow {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  ltp: number | null;
  slPrice: number | null;
  targetPrice: number | null;
  mode: string;
  status: string;
  realizedPnl: number;
  openedAt: string;
  closedAt: string | null;
}

interface ScanSignalRow {
  id: string;
  symbol: string;
  strategy: string;
  side: string;
  refPrice: number;
  price: number;
  note: string;
  placed: boolean;
  tradeId: string | null;
  createdAt: string;
}

interface ScannerData {
  config: {
    enabled: boolean;
    strategy: string;
    autoPlace: boolean;
    mode: string;
    capitalPerTrade: number;
    slPct: number;
    targetPct: number;
    squareOffTime: string;
    symbols: string[];
  };
  universe: Array<{
    symbol: string; name: string; price: number; dayOpen: number; chgPct: number;
    orbHigh: number | null; orbLow: number | null; rangeReady: boolean;
    enabled: boolean; state: string;
  }>;
  openTrades: ScanTradeRow[];
  closedTrades: ScanTradeRow[];
  signals: ScanSignalRow[];
  stats: { openTrades: number; realizedToday: number; unrealized: number; total: number; signalsToday: number };
}

const STATE_STYLES: Record<string, string> = {
  SCANNING: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  IN_TRADE: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  COOLDOWN: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  IDLE: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function Scanner() {
  const { toast } = useToast();
  const [data, refresh, loading] = usePoll<ScannerData>("/api/scanner", 3000);
  const [filter, setFilter] = useState("");
  const [cfg, setCfg] = useState<ScannerData["config"] | null>(null);
  const [saving, setSaving] = useState(false);

  // sync local config editor when server data arrives and no local edits pending
  useEffect(() => {
    if (data?.config && !cfg) setCfg(data.config);
  }, [data, cfg]);

  const act = async (body: Record<string, unknown>, okMsg?: string) => {
    try {
      await apiCall("/api/scanner", "POST", body);
      if (okMsg) toast({ title: okMsg });
      refresh();
    } catch (e) {
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const saveConfig = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await apiCall("/api/scanner", "POST", {
        action: "setConfig",
        config: {
          enabled: cfg.enabled,
          strategy: cfg.strategy,
          autoPlace: cfg.autoPlace,
          mode: cfg.mode,
          capitalPerTrade: Number(cfg.capitalPerTrade),
          slPct: Number(cfg.slPct),
          targetPct: Number(cfg.targetPct),
          squareOffTime: cfg.squareOffTime,
        },
      });
      toast({ title: "Scanner settings saved" });
      refresh();
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const universe = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toUpperCase();
    return data.universe.filter((u) => !q || u.symbol.includes(q) || u.name.toUpperCase().includes(q));
  }, [data, filter]);

  if (loading && !data) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Loading scanner…</div>;
  }
  if (!data || !cfg) return null;

  const serverEnabled = data.config.enabled;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Radar className={cn("h-5 w-5", serverEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
            Stock Scanner
          </h1>
          <p className="text-sm text-muted-foreground">
            Scan the F&amp;O universe for ORB / momentum signals and auto-place trades with SL, target and timed exit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
            serverEnabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
          )}>
            <span className={cn("h-2 w-2 rounded-full", serverEnabled ? "bg-emerald-500 animate-pulse" : "bg-zinc-400")} />
            {serverEnabled ? `Scanning · ${data.config.strategy}` : "Scanner off"}
          </div>
          <Button variant="outline" size="sm" onClick={() => void act({ action: "resetDay" }, "Simulated day reset — ranges and cooldowns cleared")}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset day
          </Button>
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <span className="block text-xs text-muted-foreground">Signals today</span>
          <span className="text-lg font-semibold tabular-nums">{data.stats.signalsToday}</span>
        </div>
        <div className="rounded-lg border p-3">
          <span className="block text-xs text-muted-foreground">Open scan trades</span>
          <span className="text-lg font-semibold tabular-nums">{data.stats.openTrades}</span>
        </div>
        <div className="rounded-lg border p-3">
          <span className="block text-xs text-muted-foreground">Realized (recent closed)</span>
          <span className={cn("text-lg font-semibold tabular-nums", pnlClass(data.stats.realizedToday))}>
            {inr(data.stats.realizedToday, { sign: true })}
          </span>
        </div>
        <div className="rounded-lg border p-3">
          <span className="block text-xs text-muted-foreground">Unrealized (open)</span>
          <span className={cn("text-lg font-semibold tabular-nums", pnlClass(data.stats.unrealized))}>
            {inr(data.stats.unrealized, { sign: true })}
          </span>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {/* config */}
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Scan configuration
              </span>
              <div className="flex items-center gap-2">
                <Label htmlFor="scan-enabled" className="text-xs text-muted-foreground">Scanner {cfg.enabled ? "on" : "off"}</Label>
                <Switch id="scan-enabled" checked={cfg.enabled} onCheckedChange={(c) => setCfg({ ...cfg, enabled: c })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <Label>Signal strategy</Label>
                <Select value={cfg.strategy} onValueChange={(v) => setCfg({ ...cfg, strategy: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ORB">ORB — opening range breakout</SelectItem>
                    <SelectItem value="MOMENTUM">Momentum — 0.5% from open</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Execution mode</Label>
                <Select value={cfg.mode} onValueChange={(v) => setCfg({ ...cfg, mode: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PAPER">Paper (simulated)</SelectItem>
                    <SelectItem value="LIVE">Live (Shoonya orders)</SelectItem>
                  </SelectContent>
                </Select>
                {cfg.mode === "LIVE" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Places real NSE market orders — needs an active Shoonya session.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Auto-place trades</Label>
                <div className="flex h-9 items-center gap-2">
                  <Switch id="auto-place" checked={cfg.autoPlace} onCheckedChange={(c) => setCfg({ ...cfg, autoPlace: c })} />
                  <Label htmlFor="auto-place" className="text-xs font-normal text-muted-foreground">
                    {cfg.autoPlace ? "Signals become trades instantly" : "Signals are logged only"}
                  </Label>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="scan-capital">Capital per trade (₹)</Label>
                <Input id="scan-capital" type="number" min={1000} step={10000} value={cfg.capitalPerTrade}
                  onChange={(e) => setCfg({ ...cfg, capitalPerTrade: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground">Qty = capital ÷ LTP (cash market, intraday).</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="scan-sl">SL %</Label>
                  <Input id="scan-sl" type="number" min={0.1} step={0.1} value={cfg.slPct}
                    onChange={(e) => setCfg({ ...cfg, slPct: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="scan-tgt">Target %</Label>
                  <Input id="scan-tgt" type="number" min={0.1} step={0.1} value={cfg.targetPct}
                    onChange={(e) => setCfg({ ...cfg, targetPct: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="scan-so">Square-off (IST)</Label>
                <Input id="scan-so" type="time" value={cfg.squareOffTime}
                  onChange={(e) => setCfg({ ...cfg, squareOffTime: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => void saveConfig()} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                <Save className="mr-1.5 h-3.5 w-3.5" />{saving ? "Saving…" : "Apply settings"}
              </Button>
            </div>
          </div>

          {/* universe */}
          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <span className="text-sm font-medium">Universe — {data.config.symbols.length}/{STOCK_UNIVERSE.length} enabled</span>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter stocks"
                    className="h-8 w-40 pl-8 text-xs" />
                </div>
                <Button variant="outline" size="sm" className="h-8"
                  onClick={() => void act({ action: "setAllSymbols", on: true }, "All 50 stocks enabled")}>All</Button>
                <Button variant="outline" size="sm" className="h-8"
                  onClick={() => void act({ action: "setAllSymbols", on: false }, "All stocks disabled")}>None</Button>
              </div>
            </div>
            <div className="max-h-[26rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/70 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 font-medium">Scan</th>
                    <th className="px-3 py-2 font-medium">Stock</th>
                    <th className="px-3 py-2 text-right font-medium">LTP</th>
                    <th className="px-3 py-2 text-right font-medium">Chg%</th>
                    <th className="px-3 py-2 text-right font-medium">ORB range</th>
                    <th className="px-3 py-2 text-right font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {universe.map((u) => (
                    <tr key={u.symbol} className={cn("border-t", u.enabled && "bg-emerald-50/40 dark:bg-emerald-950/20")}>
                      <td className="px-3 py-2">
                        <Switch checked={u.enabled} onCheckedChange={(c) => void act({ action: "toggleSymbol", symbol: u.symbol, on: c })} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="block font-medium">{u.symbol}</span>
                        <span className="block text-xs text-muted-foreground">{u.name}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">₹{u.price.toFixed(2)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", pnlClass(u.chgPct))}>
                        {u.chgPct >= 0 ? "+" : ""}{u.chgPct.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                        {u.orbHigh && u.orbLow ? `₹${u.orbLow.toFixed(2)} – ₹${u.orbHigh.toFixed(2)}` : u.rangeReady ? "—" : "forming…"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Badge className={cn("text-[10px]", STATE_STYLES[u.state])}>{u.state.replace("_", " ")}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* right rail: signals + trades */}
        <div className="space-y-5">
          <div className="rounded-lg border">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
              <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Signals
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto p-3">
              {data.signals.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No signals yet — enable stocks and wait for a breakout.</p>
              )}
              {data.signals.map((s) => (
                <div key={s.id} className="rounded-md border p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Badge variant={s.side === "LONG" ? "secondary" : "destructive"} className="text-[10px]">{s.side}</Badge>
                      {s.symbol}
                      <span className="text-muted-foreground">· {s.strategy}</span>
                    </span>
                    <span className="text-muted-foreground">{timeAgo(s.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{s.note}</p>
                  <p className="mt-1 flex items-center gap-1 tabular-nums">
                    <CircleDollarSign className="h-3 w-3" /> @ ₹{s.price.toFixed(2)}
                    {s.placed
                      ? <Badge className="ml-1 bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 text-[10px]">trade placed</Badge>
                      : <Badge variant="outline" className="ml-1 text-[10px]">logged only</Badge>}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
              <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Open scan trades
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto p-3">
              {data.openTrades.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No open scan trades.</p>
              )}
              {data.openTrades.map((t) => {
                const dir = t.side === "LONG" ? 1 : -1;
                const unrl = dir * ((t.ltp ?? t.entryPrice) - t.entryPrice) * t.qty;
                return (
                  <div key={t.id} className="rounded-md border p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Badge variant={t.side === "LONG" ? "secondary" : "destructive"} className="text-[10px]">{t.side}</Badge>
                        {t.symbol} <span className="text-muted-foreground">× {t.qty}</span>
                        <Badge variant="outline" className="text-[10px]">{t.mode}</Badge>
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void act({ action: "closeTrade", id: t.id })}>
                        Close
                      </Button>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1 tabular-nums text-muted-foreground">
                      <span>entry ₹{t.entryPrice.toFixed(2)}</span>
                      <span>ltp ₹{(t.ltp ?? t.entryPrice).toFixed(2)}</span>
                      <span>SL ₹{(t.slPrice ?? 0).toFixed(2)} · TP ₹{(t.targetPrice ?? 0).toFixed(2)}</span>
                    </div>
                    <p className={cn("mt-1 font-medium tabular-nums", pnlClass(unrl))}>Unrealized {inr(unrl, { sign: true })}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3 text-sm font-medium">Closed scan trades</div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto p-3">
              {data.closedTrades.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No closed trades yet.</p>
              )}
              {data.closedTrades.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-md border px-2.5 py-2 text-xs">
                  <span className="font-medium">{t.symbol} <span className="text-muted-foreground">· {t.side}</span></span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">{t.status.replace("CLOSED_", "").replace("_", " ")}</span>
                    <span className={cn("font-medium tabular-nums", pnlClass(t.realizedPnl))}>{inr(t.realizedPnl, { sign: true })}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Separator />
          <p className="text-xs text-muted-foreground">
            Paper mode prices are simulated walks per stock; live mode pulls real NSE quotes ({"<SYMBOL>"}-EQ) and routes market orders
            through Shoonya. One signal per stock per day; trades on one stock at a time.
          </p>
        </div>
      </div>
    </div>
  );
}
