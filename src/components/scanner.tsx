"use client";

import { useEffect, useMemo, useState } from "react";
import { Radar, RotateCcw, Save, Search, Zap, CircleDollarSign, Activity, Crosshair, Layers, ChevronDown } from "lucide-react";
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
import { PATTERN_CATEGORIES, PATTERN_DEFS, BASE_STRATEGY_IDS } from "@/lib/patterns";
import { cn } from "@/lib/utils";

interface ScanTradeRow {
  id: string;
  symbol: string;
  kind: string;
  strategy: string;
  side: string;
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  ltp: number | null;
  slPrice: number | null;
  targetPrice: number | null;
  execSymbol: string | null;
  execQty: number;
  entryPremium: number | null;
  ltpPremium: number | null;
  exitPremium: number | null;
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
  entryLevel: number | null;
  slLevel: number | null;
  targetLevel: number | null;
  note: string;
  placed: boolean;
  tradeId: string | null;
  createdAt: string;
}

interface ScannerData {
  config: {
    enabled: boolean;
    strategies: string[];
    patternParams: Record<string, Record<string, number>>;
    candleSeconds: number;
    autoPlace: boolean;
    mode: string;
    capitalPerTrade: number;
    slPct: number;
    targetPct: number;
    squareOffTime: string;
    symbols: string[];
  };
  universe: Array<{
    symbol: string; name: string; kind: string; price: number; dayOpen: number; chgPct: number;
    orbHigh: number | null; orbLow: number | null; rangeReady: boolean; bars: number;
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

const STRATEGY_LABELS: Record<string, string> = {
  ORB: "ORB",
  MOMENTUM: "Momentum",
  LIQUIDITY_SWEEP: "Liquidity Sweep",
  ORDER_BLOCK: "Order Block",
  HEAD_SHOULDERS: "Head & Shoulders",
  DOUBLE_BOTTOM: "Double Bottom",
  DOUBLE_TOP: "Double Top",
};

export function Scanner() {
  const { toast } = useToast();
  const [data, refresh, loading] = usePoll<ScannerData>("/api/scanner", 3000);
  const [filter, setFilter] = useState("");
  const [patternFilter, setPatternFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ CANDLESTICK: true });
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
          strategies: cfg.strategies,
          patternParams: cfg.patternParams,
          candleSeconds: Number(cfg.candleSeconds),
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

  const toggleStrategy = (id: string, on: boolean) => {
    if (!cfg) return;
    const set = new Set(cfg.strategies);
    if (on) set.add(id);
    else set.delete(id);
    setCfg({ ...cfg, strategies: Array.from(set) });
  };

  const setParam = (pid: string, key: string, value: number) => {
    if (!cfg) return;
    const pp = { ...cfg.patternParams };
    pp[pid] = { ...(pp[pid] ?? {}), [key]: value };
    setCfg({ ...cfg, patternParams: pp });
  };

  const setCategory = (defs: typeof PATTERN_DEFS, on: boolean) => {
    if (!cfg) return;
    const set = new Set(cfg.strategies);
    for (const p of defs) {
      if (on) set.add(p.id);
      else set.delete(p.id);
    }
    setCfg({ ...cfg, strategies: Array.from(set) });
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
  const px = (v: number, kind: string) => (kind === "INDEX" ? v.toFixed(2) : `₹${v.toFixed(2)}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Radar className={cn("h-5 w-5", serverEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
            Market Scanner
          </h1>
          <p className="text-sm text-muted-foreground">
            {PATTERN_DEFS.length} spot price-action signals on indices &amp; F&amp;O stocks — SMC setups, the full
            classical chart-pattern catalog (NCFE / Fidelity), the complete candlestick library (Groww), plus ORB &amp;
            momentum — each with an explicit entry, SL and target level, auto-placed.
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
            {serverEnabled ? `Scanning · ${cfg.strategies.length} strategies` : "Scanner off"}
          </div>
          <Button variant="outline" size="sm" onClick={() => void act({ action: "resetDay" }, "Simulated day reset — ranges, candles and cooldowns cleared")}>
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
          {/* strategies */}
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Crosshair className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Strategies &amp; levels
              </span>
              <div className="flex items-center gap-2">
                <Label htmlFor="scan-enabled" className="text-xs text-muted-foreground">Scanner {cfg.enabled ? "on" : "off"}</Label>
                <Switch id="scan-enabled" checked={cfg.enabled} onCheckedChange={(c) => setCfg({ ...cfg, enabled: c })} />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {BASE_STRATEGY_IDS.map((id) => (
                <label
                  key={id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm",
                    cfg.strategies.includes(id) ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30" : "hover:bg-accent/40",
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-emerald-600"
                    checked={cfg.strategies.includes(id)}
                    onChange={(e) => toggleStrategy(id, e.target.checked)}
                  />
                  <span className="font-medium">{STRATEGY_LABELS[id]}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {id === "ORB" ? "opening-range breakout" : "0.5% from open"}
                  </span>
                </label>
              ))}
            </div>

            {/* pattern library — grouped by category, searchable */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={patternFilter}
                    onChange={(e) => setPatternFilter(e.target.value)}
                    placeholder={`Filter ${PATTERN_DEFS.length} patterns (e.g. engulfing, triangle, gap)…`}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                  {cfg.strategies.filter((s) => s !== "ORB" && s !== "MOMENTUM").length}/{PATTERN_DEFS.length} on
                </Badge>
              </div>
              {PATTERN_CATEGORIES.map((cat) => {
                const q = patternFilter.trim().toUpperCase();
                const defs = PATTERN_DEFS.filter(
                  (p) =>
                    p.category === cat.key &&
                    (!q || p.label.toUpperCase().includes(q) || p.short.toUpperCase().includes(q) || p.id.includes(q)),
                );
                const totalInCat = PATTERN_DEFS.filter((p) => p.category === cat.key).length;
                const enabledInCat = defs.filter((p) => cfg.strategies.includes(p.id)).length;
                const open = !collapsed[cat.key] || q.length > 0;
                return (
                  <div key={cat.key} className="rounded-md border">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={open}
                        className="flex items-center gap-1.5 text-sm font-medium hover:text-emerald-700 dark:hover:text-emerald-400"
                        onClick={() => setCollapsed({ ...collapsed, [cat.key]: open })}
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
                        {cat.label}
                      </button>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          enabledInCat > 0 && "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
                        )}
                      >
                        {enabledInCat}/{defs.length || totalInCat}
                      </Badge>
                      <span className="hidden text-xs text-muted-foreground md:block">{cat.blurb}</span>
                      <span className="ml-auto flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => setCategory(defs, true)}
                        >
                          All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => setCategory(defs, false)}
                        >
                          None
                        </Button>
                      </span>
                    </div>
                    {open &&
                      (defs.length === 0 ? (
                        <p className="border-t px-3 py-2 text-xs text-muted-foreground">No patterns match the filter.</p>
                      ) : (
                        <div className="grid gap-2 border-t p-3 sm:grid-cols-2">
                          {defs.map((p) => (
                            <div
                              key={p.id}
                              className={cn(
                                "rounded-md border text-sm",
                                cfg.strategies.includes(p.id) ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30" : "hover:bg-accent/40",
                              )}
                            >
                              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 accent-emerald-600"
                                  checked={cfg.strategies.includes(p.id)}
                                  onChange={(e) => toggleStrategy(p.id, e.target.checked)}
                                />
                                <span className="font-medium">{p.label}</span>
                                <span className="ml-auto text-right text-xs text-muted-foreground">{p.short}</span>
                              </label>
                              {cfg.strategies.includes(p.id) && (
                                <div className={cn("grid gap-2 border-t px-3 py-2.5", p.category === "CANDLESTICK" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2")}>
                                  {p.params.map((pd) => (
                                    <div key={pd.key} className="space-y-0.5">
                                      <Label htmlFor={`${p.id}-${pd.key}`} className="text-[11px] text-muted-foreground">
                                        {pd.label}
                                      </Label>
                                      <Input
                                        id={`${p.id}-${pd.key}`}
                                        type="number"
                                        min={pd.min}
                                        max={pd.max}
                                        step={pd.step}
                                        className="h-8 text-xs"
                                        value={cfg.patternParams[p.id]?.[pd.key] ?? pd.def}
                                        onChange={(e) => setParam(p.id, pd.key, Number(e.target.value))}
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Sources: Groww candlestick catalog · NCFE &amp; Fidelity chart-pattern references · SMC price action.
              Signals confirm on candle close and trade against explicit levels — entry at the trigger, SL beyond the
              invalidated structure (sweep wick / OB edge / boundary line / pattern extreme), target at an R-multiple
              or the measured move.
            </p>
          </div>

          {/* config */}
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Execution
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <p className="text-xs text-amber-600 dark:text-amber-400">Places real market orders — needs an active Shoonya session.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Candle length (patterns)</Label>
                <Select value={String(cfg.candleSeconds)} onValueChange={(v) => setCfg({ ...cfg, candleSeconds: Number(v) })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 seconds</SelectItem>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="60">1 minute</SelectItem>
                    <SelectItem value="120">2 minutes</SelectItem>
                    <SelectItem value="300">5 minutes</SelectItem>
                  </SelectContent>
                </Select>
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
                <p className="text-xs text-muted-foreground">Stocks: qty = capital ÷ LTP. Indices: ATM option lots (CE on long, PE on short).</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="scan-sl">SL % <span className="text-[10px] text-muted-foreground">(ORB/Mom)</span></Label>
                  <Input id="scan-sl" type="number" min={0.1} step={0.1} value={cfg.slPct}
                    onChange={(e) => setCfg({ ...cfg, slPct: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="scan-tgt">Target % <span className="text-[10px] text-muted-foreground">(ORB/Mom)</span></Label>
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
              <span className="flex items-center gap-2 text-sm font-medium">
                <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Universe — {data.config.symbols.length}/{data.universe.length} enabled
              </span>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter symbols"
                    className="h-8 w-40 pl-8 text-xs" />
                </div>
                <Button variant="outline" size="sm" className="h-8"
                  onClick={() => void act({ action: "setAllSymbols", on: true }, `All ${data.universe.length} symbols enabled`)}>All</Button>
                <Button variant="outline" size="sm" className="h-8"
                  onClick={() => void act({ action: "setAllSymbols", on: false }, "All symbols disabled")}>None</Button>
              </div>
            </div>
            <div className="max-h-[26rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/70 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 font-medium">Scan</th>
                    <th className="px-3 py-2 font-medium">Symbol</th>
                    <th className="px-3 py-2 text-right font-medium">LTP</th>
                    <th className="px-3 py-2 text-right font-medium">Chg%</th>
                    <th className="px-3 py-2 text-right font-medium">Candles</th>
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
                        <span className="flex items-center gap-1.5 font-medium">
                          {u.symbol}
                          <Badge variant="outline" className={cn("text-[9px]", u.kind === "INDEX" && "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300")}>
                            {u.kind}
                          </Badge>
                        </span>
                        <span className="block text-xs text-muted-foreground">{u.name}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{px(u.price, u.kind)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", pnlClass(u.chgPct))}>
                        {u.chgPct >= 0 ? "+" : ""}{u.chgPct.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                        {u.bars > 0 ? u.bars : <span className="italic">warming up…</span>}
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
            <div className="max-h-72 space-y-2 overflow-y-auto p-3">
              {data.signals.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No signals yet — enable symbols and wait for a candle-close setup.</p>
              )}
              {data.signals.map((s) => (
                <div key={s.id} className="rounded-md border p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Badge variant={s.side === "LONG" ? "secondary" : "destructive"} className="text-[10px]">{s.side}</Badge>
                      {s.symbol}
                      <span className="text-muted-foreground">· {STRATEGY_LABELS[s.strategy] ?? s.strategy}</span>
                    </span>
                    <span className="text-muted-foreground">{timeAgo(s.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{s.note}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                    <CircleDollarSign className="h-3 w-3" />
                    <span>E {px(s.entryLevel ?? s.price, "INDEX")}</span>
                    <span className="text-red-600 dark:text-red-400">SL {px(s.slLevel ?? 0, "INDEX")}</span>
                    <span className="text-emerald-600 dark:text-emerald-400">TP {px(s.targetLevel ?? 0, "INDEX")}</span>
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
            <div className="max-h-64 space-y-2 overflow-y-auto p-3">
              {data.openTrades.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No open scan trades.</p>
              )}
              {data.openTrades.map((t) => {
                const isIndex = t.kind === "INDEX";
                const unrl = isIndex
                  ? ((t.ltpPremium ?? t.entryPremium ?? 0) - (t.entryPremium ?? 0)) * t.execQty
                  : (t.side === "LONG" ? 1 : -1) * ((t.ltp ?? t.entryPrice) - t.entryPrice) * t.qty;
                return (
                  <div key={t.id} className="rounded-md border p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Badge variant={t.side === "LONG" ? "secondary" : "destructive"} className="text-[10px]">{t.side}</Badge>
                        {t.symbol} <span className="text-muted-foreground">· {STRATEGY_LABELS[t.strategy] ?? t.strategy}</span>
                        <Badge variant="outline" className="text-[10px]">{t.mode}</Badge>
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void act({ action: "closeTrade", id: t.id })}>
                        Close
                      </Button>
                    </div>
                    {isIndex ? (
                      <div className="mt-1 space-y-0.5 tabular-nums text-muted-foreground">
                        <span className="block">exec {t.execSymbol} × {t.execQty}</span>
                        <span className="block">
                          spot ₹{(t.ltp ?? t.entryPrice).toFixed(2)} · prem ₹{(t.ltpPremium ?? t.entryPremium ?? 0).toFixed(2)}
                          {t.entryPremium ? ` (in ₹${t.entryPremium.toFixed(2)})` : ""}
                        </span>
                        <span className="block">SL ₹{(t.slPrice ?? 0).toFixed(2)} · TP ₹{(t.targetPrice ?? 0).toFixed(2)} <span className="text-[10px]">(spot levels)</span></span>
                      </div>
                    ) : (
                      <div className="mt-1 grid grid-cols-3 gap-1 tabular-nums text-muted-foreground">
                        <span>entry ₹{t.entryPrice.toFixed(2)}</span>
                        <span>ltp ₹{(t.ltp ?? t.entryPrice).toFixed(2)}</span>
                        <span>SL ₹{(t.slPrice ?? 0).toFixed(2)} · TP ₹{(t.targetPrice ?? 0).toFixed(2)}</span>
                      </div>
                    )}
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
                  <span className="font-medium">
                    {t.symbol} <span className="text-muted-foreground">· {t.side} · {STRATEGY_LABELS[t.strategy] ?? t.strategy}</span>
                  </span>
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
            Paper mode simulates walks for all 6 indices and 50 F&amp;O stocks and seeds candle history so patterns fire
            immediately; live mode pulls real quotes (index spot via NFO/BFO, stocks via {"<SYMBOL>"}-EQ). Index signals
            execute as ATM options (CE on LONG, PE on SHORT) with P&amp;L in premium; stock signals execute as cash
            market orders. One signal per symbol per day; one open trade per symbol.
          </p>
        </div>
      </div>
    </div>
  );
}
