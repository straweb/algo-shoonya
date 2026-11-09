// Backtesting engine.
// Deterministic, seeded synthetic minute-history per (strategy, index, horizon),
// simulated through the SAME leg builder, Black-Scholes pricer, slippage and
// margin model the paper engine uses — so backtest numbers line up with paper P&L.
//
// NOTE: the sandbox has no access to historical NSE/BSE data, so prices are
// generated as a seeded geometric walk calibrated to each index's vol. Results
// are indicative of strategy behaviour, not a forecast.

import { getInstrument, InstrumentId, optionSymbol } from "./instruments";
import { getStrategy, StrategyId } from "./strategies";
import { buildLegs } from "./plan";
import { blackScholes, roundTick } from "./pricing";
import { hhmmToMinutes } from "./market";
import { istNow } from "./market";

// ---------- seeded RNG ----------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussFactory(rand: () => number): () => number {
  return () => {
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    return Math.sqrt((-2 * Math.log(s)) / s) * u;
  };
}

// ---------- types ----------

export interface BacktestConfig {
  strategyId: StrategyId;
  instrumentId: string;
  expiryMode: "NEAREST" | "NEXT";
  days: number; // trading days to simulate
  capital: number;
  utilizationPct: number;
  legSlPct: number;
  targetProfit: number | null;
  entryTime: string;
  squareOffTime: string;
  otmGap: number; // 0 = auto
  wingGap: number; // 0 = auto
  seed?: number; // optional variation
}

export interface BacktestTrade {
  date: string;
  side: string; // SHORT | LONG | SPREAD
  lots: number;
  qty: number;
  entryAt: string;
  exitAt: string;
  reason: "TARGET" | "LEG SL" | "TIME" | "KILL SWITCH";
  netPremium: number; // net premium received(+) / paid(-) at entry, ₹
  pnl: number;
  legs: Array<{ symbol: string; side: "BUY" | "SELL"; entry: number; exit: number | null }>;
}

export interface BacktestStats {
  totalPnl: number;
  daysSimulated: number;
  daysTraded: number;
  winDays: number;
  lossDays: number;
  winRate: number; // %
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  bestDay: number;
  worstDay: number;
  avgDailyPnl: number;
  returnPct: number; // total pnl / capital %
}

export interface BacktestResult {
  config: BacktestConfig;
  instrumentLabel: string;
  strategyName: string;
  trades: BacktestTrade[];
  equity: Array<{ date: string; pnl: number; cum: number }>;
  dailyPnl: Array<{ date: string; pnl: number }>;
  stats: BacktestStats;
}

// ---------- synthetic history ----------

const MINUTES = 375; // 09:15 -> 15:30
const SESSION_START_MIN = 9 * 60 + 15;

interface DayPath {
  date: string; // yyyy-mm-dd (IST)
  open: number;
  prevClose: number;
  closes: number[];
}

function tradingDays(count: number): string[] {
  const now = istNow();
  const out: string[] = [];
  const cursor = new Date(Date.UTC(now.yyyy, now.mm - 1, now.dd));
  while (out.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      out.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out.reverse();
}

function buildPaths(
  instId: InstrumentId,
  days: string[],
  rand: () => number,
  gauss: () => number,
): DayPath[] {
  const inst = getInstrument(instId);
  const dailyVol = inst.iv / Math.sqrt(252);
  // realized intraday vol ≈ 72% of implied (variance risk premium) — keeps
  // option-selling mildly positive and option-buying tails honest
  const minuteVol = (inst.iv * 0.72) / Math.sqrt(252 * MINUTES);
  const paths: DayPath[] = [];
  let prevClose = inst.basePrice;

  for (let i = 0; i < days.length; i++) {
    // overnight gap
    const gap = gauss() * dailyVol * 0.5;
    const open = Math.max(prevClose * (1 + gap), inst.basePrice * 0.4);

    // regime: a minority of days trend with intent, most chop around the open
    const trendDay = rand() < 0.15;
    const drift = trendDay ? (rand() < 0.5 ? -1 : 1) * dailyVol * (0.35 + rand() * 0.35) / MINUTES : 0;

    const closes: number[] = [];
    let logp = Math.log(open);
    for (let m = 0; m < MINUTES; m++) {
      logp += drift + minuteVol * gauss();
      closes.push(Math.max(Math.exp(logp), inst.basePrice * 0.3));
    }
    prevClose = closes[closes.length - 1];
    paths.push({ date: days[i], open, prevClose, closes });
  }
  return paths;
}

// ---------- per-day strategy simulation ----------

const SLIPPAGE = 0.0025; // matches paper engine

function minutesSinceOpen(hhmm: string): number {
  return Math.max(0, hhmmToMinutes(hhmm) - SESSION_START_MIN);
}

interface SimLeg {
  symbol: string;
  strike: number;
  type: "CE" | "PE";
  side: "BUY" | "SELL";
  entry: number;
  entryMin: number;
  slPrice: number;
  closed: boolean;
  exit: number | null;
  exitMin: number | null;
  years0: number; // years-to-expiry at entry minute
}

function simulateDay(
  cfg: BacktestConfig,
  path: DayPath,
  daysLeftNear: number,
  rand: () => number,
): BacktestTrade | null {
  const inst = getInstrument(cfg.instrumentId);
  const strat = getStrategy(cfg.strategyId);

  const entryMin = minutesSinceOpen(cfg.entryTime);
  const exitMin = Math.min(minutesSinceOpen(cfg.squareOffTime), MINUTES - 1);
  if (entryMin >= exitMin - 2) return null;

  const spotEntry = path.closes[entryMin];

  // direction — same rule the live engine applies for AUTO strategies
  let direction: "AUTO" | "BULLISH" | "BEARISH" = strat.direction;
  if (direction === "AUTO" && (strat.id === "ORB_DIRECTIONAL" || strat.id === "MOMENTUM_BUY")) {
    direction = spotEntry >= path.open ? "BULLISH" : "BEARISH";
  }

  // synthetic expiries
  const dayMs = 86400000;
  const dayIdx = Date.parse(`${path.date}T00:00:00Z`);
  const nearDate = new Date(dayIdx + daysLeftNear * dayMs);
  const farDate = strat.calendar ? new Date(dayIdx + (daysLeftNear + 30) * dayMs) : nearDate;

  const legs = buildLegs(strat.id, {
    inst,
    spot: spotEntry,
    otmGap: cfg.otmGap,
    wingGap: cfg.wingGap,
    direction,
    expiryNear: nearDate,
    expiryFar: farDate,
  });
  if (legs.length === 0) return null;

  // margin model (identical to sizing.ts)
  const premiumAt = (strike: number, type: "CE" | "PE", m: number, yearsBase: number) => {
    const t = Math.max((yearsBase * MINUTES + (MINUTES - m)) / (MINUTES * 365), 0.15 / (365 * 24));
    return blackScholes({ spot: path.closes[m], strike, iv: inst.iv, yearsToExpiry: t, type });
  };
  const yearsNear = daysLeftNear / 365;
  const hasLongHedge = legs.some((l) => l.side === "BUY");
  let marginPerLot = 0;
  for (const l of legs) {
    if (l.side === "SELL") marginPerLot += 0.05 * spotEntry * inst.lotSize * (hasLongHedge ? 0.55 : 1);
    else marginPerLot += premiumAt(l.strike, l.optionType, entryMin, yearsNear) * inst.lotSize;
  }
  const deployable = (cfg.capital * cfg.utilizationPct) / 100;
  if (deployable < marginPerLot) return null; // cannot afford even one lot today
  let lots = Math.max(1, Math.floor(deployable / marginPerLot));

  // long options spend premium (their margin) — cap risk at 35% of deployable
  // capital per day so a debit strategy cannot bet the whole account on one day
  const allLegsBuy = legs.every((l) => l.side === "BUY");
  if (allLegsBuy) {
    const premiumPerLot = legs.reduce(
      (acc, l) => acc + premiumAt(l.strike, l.optionType, entryMin, yearsNear) * inst.lotSize,
      0,
    );
    const riskLots = Math.floor((deployable * 0.35) / Math.max(premiumPerLot, 1));
    lots = Math.max(1, Math.min(lots, riskLots || 1));
  }
  const qty = lots * inst.lotSize;

  // open legs
  const sim: SimLeg[] = legs.map((l) => {
    const yearsBase = l.expiry === farDate && strat.calendar ? (daysLeftNear + 30) / 365 : yearsNear;
    const px = roundTick(premiumAt(l.strike, l.optionType, entryMin, yearsBase));
    const entry = roundTick(px * (1 + (l.side === "BUY" ? SLIPPAGE : -SLIPPAGE)));
    return {
      symbol: optionSymbol(inst, l.expiry, l.strike, l.optionType),
      strike: l.strike,
      type: l.optionType,
      side: l.side,
      entry,
      entryMin,
      slPrice:
        l.side === "SELL"
          ? roundTick(entry * (1 + cfg.legSlPct / 100))
          : roundTick(entry * (1 - cfg.legSlPct / 100)),
      closed: false,
      exit: null,
      exitMin: null,
      years0: yearsBase,
    };
  });

  let realized = 0;
  let reason: BacktestTrade["reason"] = "TIME";
  let exitedAt = exitMin;

  for (let m = entryMin + 1; m <= exitMin; m++) {
    const spot = path.closes[m];
    let unrealized = 0;
    let openCount = 0;

    for (const leg of sim) {
      if (leg.closed) continue;
      openCount++;
      const ltp = roundTick(premiumAt(leg.strike, leg.type, m, leg.years0));
      const dir = leg.side === "SELL" ? -1 : 1;
      unrealized += dir * (ltp - leg.entry) * qty;

      const slHit = leg.side === "SELL" ? ltp >= leg.slPrice : ltp <= leg.slPrice;
      if (slHit) {
        const px = roundTick(ltp * (1 + (leg.side === "SELL" ? SLIPPAGE : -SLIPPAGE)));
        realized += dir * (px - leg.entry) * qty;
        leg.closed = true;
        leg.exit = px;
        leg.exitMin = m;
      }
    }

    const total = realized + unrealized;
    if (cfg.targetProfit && total >= cfg.targetProfit) {
      // book everything at current prices
      for (const leg of sim) {
        if (leg.closed) continue;
        const ltp = roundTick(premiumAt(leg.strike, leg.type, m, leg.years0));
        const dir = leg.side === "SELL" ? -1 : 1;
        const px = roundTick(ltp * (1 + (leg.side === "SELL" ? SLIPPAGE : -SLIPPAGE)));
        realized += dir * (px - leg.entry) * qty;
        leg.closed = true;
        leg.exit = px;
        leg.exitMin = m;
      }
      reason = "TARGET";
      exitedAt = m;
      break;
    }
    if (openCount === 0) {
      reason = "LEG SL";
      exitedAt = m;
      break;
    }
  }

  // timed square-off of whatever remains
  for (const leg of sim) {
    if (leg.closed) continue;
    const m = exitMin;
    const ltp = roundTick(premiumAt(leg.strike, leg.type, m, leg.years0));
    const dir = leg.side === "SELL" ? -1 : 1;
    const px = roundTick(ltp * (1 + (leg.side === "SELL" ? SLIPPAGE : -SLIPPAGE)));
    realized += dir * (px - leg.entry) * qty;
    leg.closed = true;
    leg.exit = px;
    leg.exitMin = m;
    if (reason === "TIME") exitedAt = m;
  }

  const allBuy = sim.every((l) => l.side === "BUY");
  const allSell = sim.every((l) => l.side === "SELL");
  const netPremium = sim.reduce(
    (acc, l) => acc + (l.side === "SELL" ? l.entry : -l.entry) * qty,
    0,
  );

  void rand;
  return {
    date: path.date,
    side: allSell ? "SHORT" : allBuy ? "LONG" : "SPREAD",
    lots,
    qty,
    entryAt: fmtMin(entryMin),
    exitAt: fmtMin(exitedAt),
    reason,
    netPremium: Math.round(netPremium),
    pnl: Math.round(realized * 100) / 100,
    legs: sim.map((l) => ({
      symbol: l.symbol,
      side: l.side,
      entry: l.entry,
      exit: l.exit,
    })),
  };
}

function fmtMin(m: number): string {
  const total = SESSION_START_MIN + m;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ---------- runner ----------

export function runBacktest(cfg: BacktestConfig): BacktestResult {
  const inst = getInstrument(cfg.instrumentId);
  const strat = getStrategy(cfg.strategyId);
  const days = tradingDays(Math.max(5, Math.min(cfg.days, 250)));
  const seed = cfg.seed ?? 0;
  const rand = mulberry32(hashString(`${cfg.strategyId}|${cfg.instrumentId}|${cfg.expiryMode}|${days.length}`) + seed);
  const gauss = gaussFactory(rand);
  const paths = buildPaths(inst.id, days, rand, gauss);

  const trades: BacktestTrade[] = [];
  const dailyPnl: Array<{ date: string; pnl: number }> = [];

  // nearest-expiry countdown: weekly indices expire every 5 sessions,
  // monthlies get a 12-30 session ladder; NEXT adds one more cycle
  // daily loop stops if the account is blown (realism guard)
  let blown = false;
  let cycle = 0;
  for (const path of paths) {
    let daysLeftNear: number;
    if (inst.weekly) {
      daysLeftNear = 1 + (cycle % 5);
    } else {
      daysLeftNear = 12 + (cycle % 19);
    }
    cycle++;
    if (cfg.expiryMode === "NEXT") daysLeftNear += inst.weekly ? 5 : 30;

    const cumSoFar = dailyPnl.reduce((a, d) => a + d.pnl, 0);
    if (cumSoFar <= -cfg.capital) {
      blown = true;
      break;
    }

    const trade = simulateDay(cfg, path, daysLeftNear, rand);
    if (trade) {
      trades.push(trade);
      dailyPnl.push({ date: path.date, pnl: trade.pnl });
    } else {
      dailyPnl.push({ date: path.date, pnl: 0 });
    }
  }
  void blown;

  // equity curve + stats
  let cum = 0;
  const equity = dailyPnl.map((d) => {
    cum += d.pnl;
    return { date: d.date, pnl: d.pnl, cum: Math.round(cum * 100) / 100 };
  });

  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  let peak = 0;
  let maxDd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.cum);
    maxDd = Math.max(maxDd, peak - e.cum);
  }

  const totalPnl = equity.length ? equity[equity.length - 1].cum : 0;
  const daysWithTrade = trades.length;
  const winDays = dailyPnl.filter((d) => d.pnl > 0).length;
  const lossDays = dailyPnl.filter((d) => d.pnl < 0).length;

  const stats: BacktestStats = {
    totalPnl: Math.round(totalPnl * 100) / 100,
    daysSimulated: days.length,
    daysTraded: daysWithTrade,
    winDays,
    lossDays,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : 0,
    avgWin: wins.length ? Math.round(grossWin / wins.length) : 0,
    avgLoss: losses.length ? Math.round(grossLoss / losses.length) : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 99 : 0,
    maxDrawdown: Math.round(maxDd * 100) / 100,
    bestDay: dailyPnl.length ? Math.max(...dailyPnl.map((d) => d.pnl)) : 0,
    worstDay: dailyPnl.length ? Math.min(...dailyPnl.map((d) => d.pnl)) : 0,
    avgDailyPnl: days.length ? Math.round(totalPnl / days.length) : 0,
    returnPct: cfg.capital > 0 ? Math.round((totalPnl / cfg.capital) * 1000) / 10 : 0,
  };

  return {
    config: cfg,
    instrumentLabel: inst.label,
    strategyName: strat.name,
    trades,
    equity,
    dailyPnl,
    stats,
  };
}
