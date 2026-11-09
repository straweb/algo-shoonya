"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/use-poll";
import { useAppStore } from "@/lib/store";
import { getStrategy } from "@/lib/strategies";
import { INSTRUMENT_LIST } from "@/lib/instruments";
import { SizingData, ExpiryInfo, inr } from "@/lib/client-types";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, AlertTriangle, CalendarDays, Check, Layers } from "lucide-react";

interface WizardState {
  instruments: string[]; // multi-index — one deployment created per index
  expiryMode: "NEAREST" | "NEXT";
  mode: "PAPER" | "LIVE";
  capital: number;
  utilizationPct: number;
  entryTime: string;
  squareOffTime: string;
  legSlPct: number;
  targetProfit: string;
  otmGap: string;
  wingGap: string;
  name: string;
  startNow: boolean;
}

const STEP_TITLES = ["Strategy & Indices", "Capital & Sizing", "Risk & Timing", "Review & Deploy"];

export function DeployWizard() {
  const { wizardStrategy, closeWizard, setTab } = useAppStore();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [sizingMap, setSizingMap] = useState<Record<string, SizingData>>({});
  const [expiryInfo, setExpiryInfo] = useState<ExpiryInfo | null>(null);
  const [activeInstruments, setActiveInstruments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const strat = useMemo(() => (wizardStrategy ? getStrategy(wizardStrategy) : null), [wizardStrategy]);

  const [w, setW] = useState<WizardState>({
    instruments: ["NIFTY"],
    expiryMode: "NEAREST",
    mode: "PAPER",
    capital: 200000,
    utilizationPct: 100,
    entryTime: "09:20",
    squareOffTime: "15:15",
    legSlPct: 50,
    targetProfit: "",
    otmGap: "",
    wingGap: "",
    name: "",
    startNow: true,
  });

  const set = <K extends keyof WizardState>(k: K, v: WizardState[K]) => setW((p) => ({ ...p, [k]: v }));

  // init per-strategy defaults on open
  useEffect(() => {
    if (!strat) return;
    setStep(0);
    setSizingMap({});
    setW((p) => ({
      ...p,
      entryTime: strat.entryTime,
      squareOffTime: strat.squareOffTime,
      name: `${p.instruments.join(" + ")} ${strat.name}`,
      otmGap: "",
      wingGap: "",
      targetProfit: "",
    }));
  }, [strat]);

  // load settings for active instruments
  useEffect(() => {
    if (!wizardStrategy) return;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { settings: { activeInstruments: string } }) => {
        const list = j.settings.activeInstruments.split(",");
        setActiveInstruments(list);
        setW((p) => {
          const keep = p.instruments.filter((i) => list.includes(i));
          return { ...p, instruments: keep.length ? keep : [list[0] ?? "NIFTY"] };
        });
      })
      .catch(() => setActiveInstruments(["NIFTY", "BANKNIFTY"]));
  }, [wizardStrategy]);

  // expiry info for the primary instrument
  const loadExpiry = useCallback(() => {
    if (!wizardStrategy) return;
    fetch(`/api/expiries?instrument=${w.instruments[0] ?? "NIFTY"}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: ExpiryInfo) => setExpiryInfo(j))
      .catch(() => {});
  }, [w.instruments, wizardStrategy]);

  useEffect(() => { loadExpiry(); }, [loadExpiry]);

  // sizing estimates — one per selected index, capital split evenly
  const instKey = w.instruments.join(",");
  useEffect(() => {
    if (!wizardStrategy || !strat || w.instruments.length === 0) return;
    const t = setTimeout(() => {
      const perIndex = w.capital / w.instruments.length;
      Promise.all(
        w.instruments.map((instId) =>
          apiCall<{ sizing: SizingData }>("/api/estimate", "POST", {
            strategyId: strat.id,
            instrumentId: instId,
            capital: perIndex,
            utilizationPct: w.utilizationPct,
            otmGap: parseInt(w.otmGap || "0", 10),
            wingGap: parseInt(w.wingGap || "0", 10),
          }).then((j) => [instId, j.sizing] as const),
        ),
      )
        .then((entries) => setSizingMap(Object.fromEntries(entries)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [wizardStrategy, strat, instKey, w.capital, w.utilizationPct, w.otmGap, w.wingGap]);

  if (!strat) return null;

  const calendar = strat.calendar;
  const showOtmGap = strat.needsOtmGap;
  const showWingGap = strat.needsWingGap;
  const dirFixed = strat.direction;
  const nIdx = w.instruments.length;
  const perIndexCapital = Math.floor(w.capital / Math.max(nIdx, 1));

  const toggleInstrument = (k: string) => {
    const has = w.instruments.includes(k);
    if (has) {
      if (w.instruments.length > 1) set("instruments", w.instruments.filter((x) => x !== k));
    } else {
      set("instruments", [...w.instruments, k].sort(
        (a, b) => INSTRUMENT_LIST.findIndex((i) => i.id === a) - INSTRUMENT_LIST.findIndex((i) => i.id === b),
      ));
    }
  };

  const validateStep = (): string | null => {
    if (step === 0) {
      if (w.instruments.length === 0) return "Select at least one index.";
      if (!w.instruments.every((i) => activeInstruments.includes(i))) return "All selected indices must be tradeable (enable them in Settings).";
    }
    if (step === 1) {
      if (!Number.isFinite(w.capital) || w.capital < 50000) return "Minimum capital allocation is ₹50,000.";
      if (perIndexCapital < 50000) return `With ${nIdx} indices each gets ${inr(perIndexCapital)} — minimum is ₹50,000 per index.`;
      const insufficient = w.instruments.find((i) => sizingMap[i] && !sizingMap[i].sufficient);
      if (insufficient && sizingMap[insufficient]) {
        return `${insufficient}: allocated capital is below the estimated margin need of ${inr(sizingMap[insufficient].estMarginPerLot)} per lot.`;
      }
    }
    if (step === 2) {
      if (w.entryTime >= w.squareOffTime) return "Entry time must be before square-off time.";
      const tp = parseFloat(w.targetProfit);
      if (w.targetProfit && (!Number.isFinite(tp) || tp <= 0)) return "Target profit must be a positive number.";
    }
    return null;
  };

  const next = () => {
    const err = validateStep();
    if (err) return toast({ title: "Check your inputs", description: err, variant: "destructive" });
    if (step < 3) {
      if (step === 0) set("name", `${w.instruments.join(" + ")} ${strat.name}`);
      setStep(step + 1);
    }
  };

  const deploy = async () => {
    setBusy(true);
    try {
      const n = w.instruments.length;
      const per = Math.floor(w.capital / n / 1000) * 1000;
      let deployed = 0;
      for (let idx = 0; idx < n; idx++) {
        const instId = w.instruments[idx];
        const cap = idx === n - 1 ? Math.max(w.capital - per * (n - 1), 50000) : per;
        await apiCall("/api/deployments", "POST", {
          name: n > 1 ? `${instId} — ${w.name}` : w.name,
          strategyType: strat.id,
          instrument: instId,
          expiryMode: calendar ? "NEAREST" : w.expiryMode,
          direction: dirFixed !== "AUTO" ? dirFixed : "AUTO",
          mode: w.mode,
          capital: cap,
          utilizationPct: w.utilizationPct,
          otmGap: parseInt(w.otmGap || "0", 10),
          wingGap: parseInt(w.wingGap || "0", 10),
          entryTime: w.entryTime,
          squareOffTime: w.squareOffTime,
          legSlPct: w.legSlPct,
          targetProfit: w.targetProfit && n === 1 ? parseFloat(w.targetProfit) : w.targetProfit ? parseFloat(w.targetProfit) / n : null,
          startNow: w.startNow,
        });
        deployed++;
      }
      toast({
        title: `${deployed} deployment${deployed === 1 ? "" : "s"} created`,
        description: w.startNow ? "The engine will enter each at the configured time." : "Saved as stopped.",
      });
      closeWizard();
      setTab("deployments");
    } catch (e) {
      toast({ title: "Could not create deployment", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const sizingEntries = w.instruments.map((i) => [i, sizingMap[i]] as const).filter(([, s]) => s !== undefined) as Array<[string, SizingData]>;
  const totalMargin = sizingEntries.reduce((a, [, s]) => a + s.estTotalMargin, 0);

  return (
    <Dialog open={!!wizardStrategy} onOpenChange={(o) => !o && closeWizard()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deploy — {strat.name}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of 4 · {STEP_TITLES[step]}
          </DialogDescription>
        </DialogHeader>

        {/* progress */}
        <div className="flex gap-1.5">
          {STEP_TITLES.map((_, i) => (
            <div key={i} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-800")} />
          ))}
        </div>

        {/* STEP 1 */}
        {step === 0 && (
          <div className="space-y-5">
            <div className="rounded-lg border bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
              <p className="font-medium">{strat.name} · <span className="text-muted-foreground">{strat.category}</span></p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{strat.legs}</p>
              {dirFixed !== "AUTO" && (
                <p className="mt-1 text-xs">View: <Badge variant="secondary">{dirFixed}</Badge></p>
              )}
              {(strat.id === "ORB_DIRECTIONAL" || strat.id === "MOMENTUM_BUY") && (
                <p className="mt-1 text-xs text-muted-foreground">Direction is automatic — Call if spot ≥ day open, Put otherwise.</p>
              )}
              {calendar && (
                <p className="mt-1 text-xs text-muted-foreground">Calendar uses nearest expiry to sell and next expiry to hedge.</p>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Indices (multi-select — one deployment per index)</Label>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" />{nIdx} selected
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"].map((k) => {
                  const disabled = !activeInstruments.includes(k);
                  const meta = INSTRUMENT_LIST.find((i) => i.id === k);
                  const selected = w.instruments.includes(k);
                  return (
                    <button
                      key={k}
                      disabled={disabled}
                      onClick={() => toggleInstrument(k)}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        selected ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" : "hover:bg-accent",
                        disabled && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{k}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
                      </span>
                      <span className="block text-xs text-muted-foreground">{meta ? `${meta.exchange} · lot ${meta.lotSize}` : "—"}{disabled ? " · off" : ""}</span>
                    </button>
                  );
                })}
              </div>
              {nIdx > 1 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Capital of {inr(w.capital)} will split into {nIdx} × ~{inr(perIndexCapital)} and create {nIdx} independent deployments you can manage separately.
                </p>
              )}
            </div>

            {!calendar && (
              <div>
                <Label className="mb-2 block">Expiry selection</Label>
                <RadioGroup value={w.expiryMode} onValueChange={(v) => set("expiryMode", v as "NEAREST" | "NEXT")} className="grid grid-cols-2 gap-2">
                  {(["NEAREST", "NEXT"] as const).map((m) => {
                    const info = expiryInfo?.expiries[m === "NEAREST" ? 0 : 1];
                    return (
                      <Label key={m} htmlFor={`exp-${m}`} className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border p-3",
                        w.expiryMode === m && "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
                      )}>
                        <RadioGroupItem id={`exp-${m}`} value={m} className="mt-0.5" />
                        <span>
                          <span className="block text-sm font-medium">{m === "NEAREST" ? "Nearest expiry" : "Next expiry"}</span>
                          <span className="block text-xs text-muted-foreground">
                            {info ? `${info.label} · ${info.kind} · ${info.tte} left` : "—"}
                          </span>
                        </span>
                      </Label>
                    );
                  })}
                </RadioGroup>
                <p className="mt-1.5 text-xs text-muted-foreground">Applies to every selected index (each resolves its own expiry date).</p>
              </div>
            )}

            <div>
              <Label className="mb-2 block">Execution mode</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["PAPER", "LIVE"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => set("mode", m)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      w.mode === m ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" : "hover:bg-accent",
                    )}
                  >
                    <span className="block text-sm font-semibold">{m === "PAPER" ? "Paper Trading" : "Live Trading"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {m === "PAPER" ? "Simulated fills on the paper engine" : "Real orders via Shoonya Noren API"}
                    </span>
                  </button>
                ))}
              </div>
              {w.mode === "LIVE" && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Live mode sends real market orders from your Shoonya account for every selected index. Make sure API trading is enabled and funds are available.
                </p>
              )}
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="capital">Capital allocation (₹, total)</Label>
                <Input id="capital" type="number" min={50000} step={10000} value={w.capital}
                  onChange={(e) => set("capital", Number(e.target.value))} className="mt-1.5" />
                <p className="mt-1 text-xs text-muted-foreground">
                  Split across {nIdx} index{nIdx === 1 ? "" : "es"} — {inr(perIndexCapital)} each.
                </p>
              </div>
              <div>
                <Label htmlFor="util">Capital utilization — {w.utilizationPct}%</Label>
                <Slider id="util" className="mt-3" min={10} max={100} step={5} value={[w.utilizationPct]}
                  onValueChange={(v) => set("utilizationPct", v[0])} />
                <p className="mt-1.5 text-xs text-muted-foreground">Share of allocation the engine may actually use ({inr((w.capital * w.utilizationPct) / 100)}).</p>
              </div>
            </div>

            {sizingEntries.length > 0 && (
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">Position sizing per index</span>
                  <span className="text-xs text-muted-foreground">Est. total margin <span className="font-medium tabular-nums">{inr(totalMargin)}</span></span>
                </div>
                <div className="space-y-3">
                  {sizingEntries.map(([instId, s]) => (
                    <div key={instId} className="rounded-lg border bg-zinc-50 p-3 dark:bg-zinc-900">
                      <div className="mb-2 flex items-center justify-between">
                        <Badge variant="secondary">{instId}</Badge>
                        <Badge variant={s.sufficient ? "secondary" : "destructive"}>
                          {s.sufficient ? `${s.lots} lot${s.lots === 1 ? "" : "s"}` : "insufficient capital"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                        <div><span className="block text-muted-foreground">Spot</span><span className="font-medium tabular-nums">{s.spot.toLocaleString("en-IN")}</span></div>
                        <div><span className="block text-muted-foreground">ATM</span><span className="font-medium tabular-nums">{s.atm.toLocaleString("en-IN")}</span></div>
                        <div><span className="block text-muted-foreground">Margin / lot</span><span className="font-medium tabular-nums">{inr(s.estMarginPerLot)}</span></div>
                        <div><span className="block text-muted-foreground">Total margin</span><span className="font-medium tabular-nums">{inr(s.estTotalMargin)}</span></div>
                      </div>
                      <div className="mt-2 space-y-0.5">
                        {s.legsPreview.map((l) => (
                          <div key={l.symbol} className="flex items-center justify-between font-mono text-[11px]">
                            <span className={cn(l.side === "SELL" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                              {l.side} {l.symbol}
                            </span>
                            <span className="tabular-nums">₹{l.estPrice.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3 */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="entryTime">Entry time (IST)</Label>
                <Input id="entryTime" type="time" value={w.entryTime} onChange={(e) => set("entryTime", e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="soTime">Square-off time (IST)</Label>
                <Input id="soTime" type="time" value={w.squareOffTime} onChange={(e) => set("squareOffTime", e.target.value)} className="mt-1.5" />
              </div>
            </div>

            <div>
              <Label htmlFor="sl">Per-leg stop-loss — {w.legSlPct}% premium move</Label>
              <Slider id="sl" className="mt-3" min={20} max={100} step={5} value={[w.legSlPct]} onValueChange={(v) => set("legSlPct", v[0])} />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Sell legs exit when premium rises {w.legSlPct}% above entry; buy legs exit when it falls {w.legSlPct}%. Engine monitors every 3 seconds.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="target">Target profit (₹, optional)</Label>
                <Input id="target" type="number" min={0} step={500} placeholder="e.g. 8000" value={w.targetProfit}
                  onChange={(e) => set("targetProfit", e.target.value)} className="mt-1.5" />
                <p className="mt-1 text-xs text-muted-foreground">
                  Per deployment {nIdx > 1 ? `— split as ${inr((parseFloat(w.targetProfit) || 0) / nIdx)} per index` : "when combined P&L reaches this"}.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {showOtmGap && (
                  <div>
                    <Label htmlFor="otmGap">OTM gap (pts)</Label>
                    <Input id="otmGap" type="number" min={0} step={25} placeholder="0 = auto" value={w.otmGap}
                      onChange={(e) => set("otmGap", e.target.value)} className="mt-1.5" />
                  </div>
                )}
                {showWingGap && (
                  <div>
                    <Label htmlFor="wingGap">Wing (pts)</Label>
                    <Input id="wingGap" type="number" min={0} step={25} placeholder="0 = auto" value={w.wingGap}
                      onChange={(e) => set("wingGap", e.target.value)} className="mt-1.5" />
                  </div>
                )}
                {!showOtmGap && !showWingGap && (
                  <p className="col-span-2 self-end text-xs text-muted-foreground sm:pb-2">
                    <CalendarDays className="mr-1 inline h-3.5 w-3.5" />Strikes are ATM for this strategy.
                  </p>
                )}
              </div>
            </div>

            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Global protections still apply: the day max-loss kill switch (Settings) and {w.squareOffTime} IST timed exit override everything.
            </p>
          </div>
        )}

        {/* STEP 4 */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <Label htmlFor="dname">Deployment name {nIdx > 1 && <span className="font-normal text-muted-foreground">(prefixed with each index)</span>}</Label>
              <Input id="dname" value={w.name} onChange={(e) => set("name", e.target.value)} className="mt-1.5" />
            </div>
            {nIdx > 1 && (
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">Will create {nIdx} deployments</p>
                <div className="flex flex-wrap gap-1.5">
                  {w.instruments.map((instId, i) => (
                    <Badge key={instId} variant="secondary" className="text-xs">
                      {instId} · {inr(i === nIdx - 1 ? Math.max(w.capital - Math.floor(w.capital / nIdx / 1000) * 1000 * (nIdx - 1), 50000) : Math.floor(w.capital / nIdx / 1000) * 1000)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-lg border">
              {[
                ["Strategy", strat.name],
                ["Indices", w.instruments.join(" · ")],
                ["Expiry", calendar ? "Nearest (sell) + Next (hedge)" : w.expiryMode === "NEAREST" ? `Nearest — ${expiryInfo?.nearest.label ?? ""}` : `Next — ${expiryInfo?.next.label ?? ""}`],
                ["Mode", w.mode === "PAPER" ? "Paper trading" : "Live trading (Shoonya)"],
                ["Lots / index", sizingEntries.map(([id, s]) => `${id} ${s.lots}`).join(" · ") || "—"],
                ["Capital", `${inr(w.capital)} total · ${w.utilizationPct}% utilized`],
                ["Entry → Exit", `${w.entryTime} → ${w.squareOffTime} IST`],
                ["Per-leg SL", `${w.legSlPct}% of leg premium`],
                ["Target", w.targetProfit ? `${inr(parseFloat(w.targetProfit))} total${nIdx > 1 ? ` (${inr(parseFloat(w.targetProfit) / nIdx)} per index)` : ""}` : "Disabled"],
                ...(showOtmGap ? [["OTM gap", parseInt(w.otmGap || "0", 10) ? `${w.otmGap} pts` : "Auto (~0.4% of spot)"]] : []),
                ...(showWingGap ? [["Wing gap", parseInt(w.wingGap || "0", 10) ? `${w.wingGap} pts` : "Auto (~0.6% of spot)"]] : []),
              ].map(([k, v], i) => (
                <div key={i} className={cn("flex items-center justify-between px-4 py-2 text-sm", i > 0 && "border-t")}>
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="startNow" className="text-sm">Start immediately</Label>
                <p className="text-xs text-muted-foreground">Engine enters at/after {w.entryTime} IST while the market is open.</p>
              </div>
              <Switch id="startNow" checked={w.startNow} onCheckedChange={(c) => set("startNow", c)} />
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => (step === 0 ? closeWizard() : setStep(step - 1))}>
            <ChevronLeft className="mr-1 h-4 w-4" />{step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 3 ? (
            <Button onClick={next}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
          ) : (
            <Button onClick={deploy} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
              {busy ? "Deploying…" : (<><Check className="mr-1 h-4 w-4" />Deploy {nIdx > 1 ? `${nIdx} deployments` : w.mode === "LIVE" ? "LIVE" : "Paper"}</>)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
