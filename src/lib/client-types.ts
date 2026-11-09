// Shared client-side types + formatters

export interface DeploymentRow {
  id: string;
  name: string;
  strategyType: string;
  instrument: string;
  expiryMode: string;
  expiryDate: string | null;
  direction: string;
  mode: "PAPER" | "LIVE";
  status: "RUNNING" | "PAUSED" | "STOPPED" | "COMPLETED" | "KILLED" | "ERROR";
  statusNote: string | null;
  capital: number;
  utilizationPct: number;
  lots: number;
  otmGap: number;
  wingGap: number;
  entryTime: string;
  squareOffTime: string;
  legSlPct: number;
  targetProfit: number | null;
  realizedPnl: number;
  unrealized: number;
  totalPnl: number;
  openLegs?: number;
  totalLegs?: number;
  legs?: LegRow[];
  createdAt: string;
}

export interface LegRow {
  id: string;
  symbol: string;
  exchange: string;
  strike: number;
  optionType: "CE" | "PE";
  side: "BUY" | "SELL";
  lotSize: number;
  qty: number;
  expiryDate: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  ltp: number | null;
  slPrice: number | null;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  realizedPnl: number;
}

export interface OrderRow {
  id: string;
  deploymentId: string | null;
  tsym: string;
  exchange: string;
  side: "B" | "S";
  qty: number;
  price: number;
  priceType: string;
  mode: "PAPER" | "LIVE";
  status: string;
  brokerOrderId: string | null;
  message: string | null;
  createdAt: string;
  deployment?: { name: string; instrument: string; strategyType: string } | null;
}

export interface EventRow {
  id: string;
  deploymentId: string | null;
  level: "INFO" | "WARN" | "ERROR" | "TRADE";
  type: string;
  message: string;
  createdAt: string;
  deployment?: { name: string } | null;
}

export interface OverviewData {
  market: { open: boolean; sim: boolean; istTime: string; istDate: string; dow: number };
  settings: { dayMaxLoss: number; paperCapital: number; defaultSquareOff: string; activeInstruments: string } | null;
  totals: {
    allocated: number; totalPnl: number; realized: number; unrealized: number;
    running: number; paused: number; total: number; ordersCount: number;
  };
  killSwitch: { dayMaxLoss: number; lossUsed: number };
  deployments: DeploymentRow[];
  events: EventRow[];
  pnlSeries: Array<{ t: string; pnl: number }>;
  paperSpots: Record<string, number>;
  brokerStatus: { configured: boolean; status: string; userId: string | null; lastError: string | null };
}

export interface SizingData {
  lots: number;
  estMarginPerLot: number;
  estTotalMargin: number;
  estPremiumPerLot: number;
  capitalDeployable: number;
  sufficient: boolean;
  legsPreview: Array<{ symbol: string; side: string; strike: number; type: string; estPrice: number }>;
  spot: number;
  atm: number;
}

export interface ExpiryInfo {
  instrument: string;
  exchange: string;
  lotSize: number;
  strikeStep: number;
  spot: number;
  nearest: { iso: string; label: string };
  next: { iso: string; label: string };
  expiries: Array<{ mode: string; iso: string; label: string; daysLeft: number; tte: string; kind: string }>;
}

export function inr(v: number, opts: { sign?: boolean; decimals?: number } = {}): string {
  const { sign = false, decimals = 0 } = opts;
  const abs = Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  if (sign) return v >= 0 ? `+₹${abs}` : `-₹${abs}`;
  return v < 0 ? `-₹${abs}` : `₹${abs}`;
}

export function pnlClass(v: number): string {
  if (v > 0.005) return "text-emerald-600 dark:text-emerald-400";
  if (v < -0.005) return "text-rose-600 dark:text-rose-400";
  return "text-muted-foreground";
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const STATUS_STYLES: Record<string, string> = {
  RUNNING: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  PAUSED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  STOPPED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  COMPLETED: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  KILLED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  ERROR: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};
