"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { FlaskConical, RefreshCw, Play, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/use-poll";
import { STRATEGY_LIST, getStrategy, StrategyId } from "@/lib/strategies";
import { INSTRUMENT_LIST } from "@/lib/instruments";
import type { BacktestResult } from "@/lib/backtest";
import { inr, pnlClass } from "@/lib/client-types";
import { cn } from "@/lib/utils";

interface BtForm {
  strategyId: StrategyId;
  instrumentId: string;
  expiryMode: "NEAREST" | "NEXT";
  days: number;
  capital: number;
  utilizationPct: number;
  legSlPct: number;
  targetProfit: string;
  entryTime: string;
  squareOffTime: string;
  otmGap: string;
  wingGap: string;
  seed: number;
}

const DAY_OPTIONS = [15, 30, 60, 90, 120];

export function Backtest() {
  const { toast } = useToast();
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<BtForm>({
    strategyId: "SHORT_STRADDLE_920",
    instrumentId: "NIFTY",
    expiryMode: "NEAREST",
    days: 30,
    capital: 200000,
    utilizationPct: 100,
    legSlPct: 50,
    targetProfit: "",
    entryTime: "09:20",
    squareOffTime: "15:15",
    otmGap: "",
    wingGap: "",
    seed: 0,
  });

  const set = <K extends keyof BtForm>(k: K, v: BtForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const strat = useMemo(() => getStrategy(f.strategyId), [f.strategyId]);

  const run = useCallback(async (form: BtForm) => {
    setBusy(true);
    try {
      const j = await apiCall<{ result: BacktestResult }>("/api/backtest", "POST", {
        strategyId: form.strategyId,
        instrumentId: form.instrumentId,
        expiryMode: form.expiryMode,
        days: form.days,
        capital: form.capital,
        utilizationPct: form.utilizationPct,
        legSlPct: form.legSlPct,
        targetProfit: form.targetProfit ? parseFloat(form.targetProfit) : null,
        entryTime: form.entryTime,
        squareOffTime: form.squareOffTime,
        otmGap: parseInt(form.otmGap || "0", 10),
        wingGap: parseInt(form.wingGap || "0", 10),
        seed: form.seed,
      });
      setResult(j.result);
    } catch (e) {
      toast({ title: "Backtest failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  // run once on mount so the page shows results immediately
  useEffect(() => { void run(f); }, []);

  const onStrategyChange = (id: string) => {
    const s = getStrategy(id);
    setF((p) => ({ ...p, strategyId: id as StrategyId, entryTime: s.entryTime, squareOffTime: s.squareOffTime }));
  };

  const st = result?.stats;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <FlaskConical className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            Strategy Backtest
          </h1>
          <p className="text-sm text-muted-foreground">
            Simulate any strategy on generated minute-history, with equity curve, daily P&amp;L and the full past-trades log.
          </p>
        </div>
        <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
          Simulated data — indicative behaviour, not a forecast
        </Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* config panel */}
        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label>Strategy</Label>
            <Select value={f.strategyId} onValueChange={onStrategyChange}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {STRATEGY_LIST.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Index</Label>
              <Select value={f.instrumentId} onValueChange={(v) => set("instrumentId", v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INSTRUMENT_LIST.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Expiry</Label>
              <Select value={f.expiryMode} onValueChange={(v) => set("expiryMode", v as "NEAREST" | "NEXT")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NEAREST">Nearest</SelectItem>
                  <SelectItem value="NEXT">Next</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>History — {f.days} trading days</Label>
            <Select value={String(f.days)} onValueChange={(v) => set("days", parseInt(v, 10))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bt-capital">Capital (₹)</Label>
              <Input id="bt-capital" type="number" min={50000} step={10000} value={f.capital}
                onChange={(e) => set("capital", Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bt-target">Target profit (₹)</Label>
              <Input id="bt-target" type="number" min={0} step={500} placeholder="off" value={f.targetProfit}
                onChange={(e) => set("targetProfit", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bt-util">Utilization — {f.utilizationPct}%</Label>
            <Slider id="bt-util" min={10} max={100} step={5} value={[f.utilizationPct]}
              onValueChange={(v) => set("utilizationPct", v[0])} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bt-sl">Per-leg stop-loss — {f.legSlPct}%</Label>
            <Slider id="bt-sl" min={20} max={100} step={5} value={[f.legSlPct]}
              onValueChange={(v) => set("legSlPct", v[0])} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bt-entry">Entry time</Label>
              <Input id="bt-entry" type="time" value={f.entryTime} onChange={(e) => set("entryTime", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bt-exit">Square-off</Label>
              <Input id="bt-exit" type="time" value={f.squareOffTime} onChange={(e) => set("squareOffTime", e.target.value)} />
            </div>
          </div>

          {(strat.needsOtmGap || strat.needsWingGap) && (
            <div className="grid grid-cols-2 gap-3">
              {strat.needsOtmGap && (
                <div className="space-y-1">
                  <Label htmlFor="bt-otm">OTM gap (pts)</Label>
                  <Input id="bt-otm" type="number" min={0} step={25} placeholder="0 = auto" value={f.otmGap}
                    onChange={(e) => set("otmGap", e.target.value)} />
                </div>
              )}
              {strat.needsWingGap && (
                <div className="space-y-1">
                  <Label htmlFor="bt-wing">Wing (pts)</Label>
                  <Input id="bt-wing" type="number" min={0} step={25} placeholder="0 = auto" value={f.wingGap}
                    onChange={(e) => set("wingGap", e.target.value)} />
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => void run(f)} disabled={busy}>
              {busy ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              {busy ? "Running…" : "Run backtest"}
            </Button>
            <Button variant="outline" size="icon" title="Regenerate price history"
              onClick={() => {
                const nf = { ...f, seed: Math.floor(Math.random() * 1e9) };
                setF(nf);
                void run(nf);
              }}>
              <Shuffle className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* results */}
        <div className="space-y-4">
          {!result && busy && (
            <div className="flex h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">
              Simulating {f.days} trading days…
            </div>
          )}

          {result && st && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Total P&L" value={inr(st.totalPnl, { sign: true })} cls={pnlClass(st.totalPnl)} />
                <StatTile label="Return on capital" value={`${st.returnPct >= 0 ? "+" : ""}${st.returnPct}%`} cls={pnlClass(st.returnPct)} />
                <StatTile label="Win rate" value={`${st.winRate}%`} sub={`${st.winDays}W · ${st.lossDays}L days`} />
                <StatTile label="Profit factor" value={st.profitFactor.toFixed(2)} sub="gross win ÷ gross loss" />
                <StatTile label="Max drawdown" value={inr(-st.maxDrawdown)} cls="text-rose-600 dark:text-rose-400" />
                <StatTile label="Trades" value={String(st.daysTraded)} sub={`of ${st.daysSimulated} days`} />
                <StatTile label="Avg win / loss" value={`${inr(st.avgWin)} / ${inr(st.avgLoss)}`} />
                <StatTile label="Best / worst day" value={`${inr(st.bestDay, { sign: true })} / ${inr(st.worstDay, { sign: true })}`} />
              </div>

              <Tabs defaultValue="equity">
                <TabsList>
                  <TabsTrigger value="equity">Equity curve</TabsTrigger>
                  <TabsTrigger value="daily">Daily P&amp;L</TabsTrigger>
                  <TabsTrigger value="trades">Past trades ({result.trades.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="equity" className="mt-3">
                  <div className="h-72 rounded-lg border p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={result.equity} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
                        <defs>
                          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#888" strokeOpacity={0.12} vertical={false} />
                        <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickFormatter={(v: number) => inr(v)} tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} width={64} />
                        <Tooltip
                          formatter={(v) => [inr(Number(v), { sign: true }), "Cumulative P&L"]}
                          labelFormatter={(l) => String(l)}
                          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
                        />
                        <ReferenceLine y={0} stroke="#888" strokeOpacity={0.4} strokeDasharray="4 4" />
                        <Area type="monotone" dataKey="cum" stroke="#059669" strokeWidth={2} fill="url(#eqFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </TabsContent>

                <TabsContent value="daily" className="mt-3">
                  <div className="h-72 rounded-lg border p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={result.dailyPnl} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
                        <CartesianGrid stroke="#888" strokeOpacity={0.12} vertical={false} />
                        <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickFormatter={(v: number) => inr(v)} tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} width={64} />
                        <Tooltip
                          formatter={(v) => [inr(Number(v), { sign: true }), "Day P&L"]}
                          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
                        />
                        <ReferenceLine y={0} stroke="#888" strokeOpacity={0.4} />
                        <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                          {result.dailyPnl.map((d, i) => (
                            <Cell key={i} fill={d.pnl > 0 ? "#10b981" : d.pnl < 0 ? "#f43f5e" : "#d4d4d8"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </TabsContent>

                <TabsContent value="trades" className="mt-3">
                  <div className="max-h-96 overflow-y-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/70 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                        <tr>
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Side</th>
                          <th className="px-3 py-2 text-right font-medium">Lots</th>
                          <th className="px-3 py-2 font-medium">Entry → Exit</th>
                          <th className="px-3 py-2 font-medium">Reason</th>
                          <th className="px-3 py-2 text-right font-medium">Net premium</th>
                          <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades.map((t) => (
                          <tr key={t.date} className="border-t">
                            <td className="px-3 py-2 tabular-nums">{t.date}</td>
                            <td className="px-3 py-2">
                              <Badge variant={t.side === "SHORT" ? "destructive" : t.side === "LONG" ? "secondary" : "outline"} className="text-[10px]">
                                {t.side}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{t.lots}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">{t.entryAt} → {t.exitAt}</td>
                            <td className="px-3 py-2 text-xs">{t.reason}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{inr(t.netPremium, { sign: true })}</td>
                            <td className={cn("px-3 py-2 text-right font-medium tabular-nums", pnlClass(t.pnl))}>{inr(t.pnl, { sign: true })}</td>
                          </tr>
                        ))}
                        {result.trades.length === 0 && (
                          <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No trades triggered in this window.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
              </Tabs>

              <p className="text-xs text-muted-foreground">
                {result.strategyName} · {result.instrumentLabel} · {result.config.expiryMode.toLowerCase()} expiry ·
                {" "}{result.config.days} days · {inr(result.config.capital)} @ {result.config.utilizationPct}% ·
                {" "}entry {result.config.entryTime}, exit {result.config.squareOffTime} IST.
                Fills include 0.25% slippage; margins use the SPAN-aligned estimate.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className={cn("mt-0.5 block font-semibold tabular-nums", cls)}>{value}</span>
      {sub && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
