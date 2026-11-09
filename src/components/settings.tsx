"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/use-poll";
import { RadioTower, ShieldCheck, ListChecks, Loader2, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrokerState {
  configured: boolean;
  status: string;
  userId?: string | null;
  vendorCode?: string | null;
  imei?: string | null;
  hasTotp?: boolean;
  accountId?: string | null;
  lastLoginAt?: string | null;
  lastError?: string | null;
}

interface SettingsState {
  dayMaxLoss: number;
  paperCapital: number;
  defaultSquareOff: string;
  activeInstruments: string;
  paperSimulate: boolean;
}

const ALL_INSTRUMENTS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];

export function SettingsView() {
  const { toast } = useToast();
  const [broker, setBroker] = useState<BrokerState | null>(null);
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [form, setForm] = useState({ userId: "", password: "", factor2: "", vendorCode: "", apiKey: "", imei: "shoonyaalgo01", totpSecret: "" });
  const [risk, setRisk] = useState({ dayMaxLoss: 10000, paperCapital: 1000000, defaultSquareOff: "15:15", paperSimulate: true });
  const [instruments, setInstruments] = useState<string[]>(ALL_INSTRUMENTS);
  const [savingBroker, setSavingBroker] = useState(false);
  const [savingRisk, setSavingRisk] = useState(false);

  const load = () => {
    fetch("/api/broker", { cache: "no-store" }).then((r) => r.json()).then(setBroker).catch(() => {});
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { settings: SettingsState }) => {
        setSettings(j.settings);
        setRisk({
          dayMaxLoss: j.settings.dayMaxLoss,
          paperCapital: j.settings.paperCapital,
          defaultSquareOff: j.settings.defaultSquareOff,
          paperSimulate: j.settings.paperSimulate,
        });
        setInstruments(j.settings.activeInstruments.split(","));
      })
      .catch(() => {});
  };
  useEffect(load, []);

  const saveBroker = async () => {
    setSavingBroker(true);
    try {
      const res = await apiCall<{ ok: boolean; error?: string; note: string }>("/api/broker", "POST", form);
      toast({ title: res.ok ? "Shoonya connected" : "Saved with login error", description: res.note + (res.error ? ` — ${res.error}` : ""), variant: res.ok ? "default" : "destructive" });
      load();
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingBroker(false);
    }
  };

  const disconnect = async () => {
    try {
      await apiCall("/api/broker", "DELETE");
      toast({ title: "Session cleared", description: "Broker session token removed. Credentials were kept." });
      load();
    } catch (e) {
      toast({ title: "Could not disconnect", description: (e as Error).message, variant: "destructive" });
    }
  };

  const saveRisk = async () => {
    setSavingRisk(true);
    try {
      await apiCall("/api/settings", "PUT", {
        dayMaxLoss: risk.dayMaxLoss,
        paperCapital: risk.paperCapital,
        defaultSquareOff: risk.defaultSquareOff,
        paperSimulate: risk.paperSimulate,
        activeInstruments: instruments,
      });
      toast({ title: "Settings saved" });
      load();
    } catch (e) {
      toast({ title: "Could not save settings", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingRisk(false);
    }
  };

  const connected = broker?.status === "CONNECTED";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Broker connection, risk limits and the tradeable instrument list.</p>
      </div>

      {/* broker */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><RadioTower className="h-4.5 w-4.5" /> Shoonya (Finvasia) Broker</CardTitle>
          <CardDescription>
            Connect your Shoonya account for live trading. Credentials are stored only in this machine&apos;s local database and are never sent anywhere else.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge className={cn(
              connected ? "bg-emerald-600" : broker?.configured ? "bg-amber-500" : "bg-zinc-400",
            )}>
              {broker?.status === "CONNECTED" ? "CONNECTED" : broker?.status === "ERROR" ? "LOGIN ERROR" : "NOT CONNECTED"}
            </Badge>
            {broker?.configured && <span className="text-xs text-muted-foreground">user {broker.userId} · API key saved · {broker.hasTotp ? "TOTP enabled" : "PAN as 2FA"}</span>}
          </div>
          {broker?.lastError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Last login error: {broker.lastError}
              {broker.lastError.includes("Network error") && " — this sandbox may block outbound calls to api.shoonya.com; run the app on your own machine for live trading, paper mode works everywhere."}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="User ID" value={form.userId} onChange={(v) => setForm({ ...form, userId: v })} placeholder="e.g. FA123456" />
            <Field label="Password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" placeholder="••••••••" />
            <Field label="PAN / 2FA factor" value={form.factor2} onChange={(v) => setForm({ ...form, factor2: v })} placeholder="ABCPD1234F" />
            <Field label="Vendor code" value={form.vendorCode} onChange={(v) => setForm({ ...form, vendorCode: v })} placeholder="FA123456_U" />
            <Field label="API key (app_idkey)" value={form.apiKey} onChange={(v) => setForm({ ...form, apiKey: v })} placeholder="from Shoonya API dashboard" />
            <Field label="IMEI / device id" value={form.imei} onChange={(v) => setForm({ ...form, imei: v })} />
            <Field label="TOTP secret (optional)" value={form.totpSecret} onChange={(v) => setForm({ ...form, totpSecret: v })} placeholder="base32 secret for auto-2FA" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveBroker} disabled={savingBroker}>
              {savingBroker ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
              Save &amp; Test Connection
            </Button>
            {broker?.configured && (
              <Button variant="outline" onClick={disconnect}><Unplug className="mr-1.5 h-4 w-4" />Clear Session</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Get your API key from the Shoonya API dashboard (api.shoonya.com → Add App). TOTP secret replaces the PAN factor when enabled in your broker 2FA settings.
          </p>
        </CardContent>
      </Card>

      {/* risk */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4.5 w-4.5" /> Risk &amp; Capital Defaults</CardTitle>
          <CardDescription>Global protections that apply across every deployment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="dml">Day max loss (₹)</Label>
              <Input id="dml" type="number" min={500} step={500} value={risk.dayMaxLoss}
                onChange={(e) => setRisk({ ...risk, dayMaxLoss: Number(e.target.value) })} className="mt-1.5" />
              <p className="mt-1 text-xs text-muted-foreground">Kill switch — squares off everything when combined P&amp;L hits -₹{Number(risk.dayMaxLoss || 0).toLocaleString("en-IN")}.</p>
            </div>
            <div>
              <Label htmlFor="pcap">Paper capital (₹)</Label>
              <Input id="pcap" type="number" min={100000} step={50000} value={risk.paperCapital}
                onChange={(e) => setRisk({ ...risk, paperCapital: Number(e.target.value) })} className="mt-1.5" />
              <p className="mt-1 text-xs text-muted-foreground">Virtual capital used by the paper engine.</p>
            </div>
            <div>
              <Label htmlFor="dso">Default square-off (IST)</Label>
              <Input id="dso" type="time" value={risk.defaultSquareOff}
                onChange={(e) => setRisk({ ...risk, defaultSquareOff: e.target.value })} className="mt-1.5" />
              <p className="mt-1 text-xs text-muted-foreground">Used when a deployment doesn&apos;t set its own exit time.</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="sim" className="text-sm">Simulate paper sessions outside market hours</Label>
              <p className="text-xs text-muted-foreground">
                When the market is closed, the paper engine keeps running a simulated session so you can watch entries, stops and targets live. Live deployments always follow real market hours.
              </p>
            </div>
            <Switch id="sim" checked={risk.paperSimulate} onCheckedChange={(c) => setRisk({ ...risk, paperSimulate: c })} />
          </div>
          <Separator />
          <div>
            <div className="mb-2 flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              <span className="text-sm font-medium">Stocks &amp; indices to trade (watchlist)</span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Only index options are traded (per your rule) — toggle which indices appear in the deploy wizard.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_INSTRUMENTS.map((k) => {
                const on = instruments.includes(k);
                return (
                  <div key={k} className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2.5",
                    on ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30" : "",
                  )}>
                    <span className="text-sm font-medium">{k}</span>
                    <Switch
                      checked={on}
                      aria-label={`Toggle ${k}`}
                      onCheckedChange={(c) => setInstruments((p) => (c ? [...p, k] : p.filter((x) => x !== k)))}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <Button onClick={saveRisk} disabled={savingRisk}>
            {savingRisk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save Risk Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={`f-${label}`}>{label}</Label>
      <Input id={`f-${label}`} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-1.5" />
    </div>
  );
}
