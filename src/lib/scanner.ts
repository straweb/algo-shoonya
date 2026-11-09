// Market scanner engine.
// A singleton 5s loop that:
//  - walks simulated prices for the 6 indices + NSE F&O stock universe (paper)
//  - pulls real quotes via Shoonya when a LIVE scanner is enabled
//  - builds rolling candles and evaluates spot price-action patterns:
//      LIQUIDITY_SWEEP · ORDER_BLOCK · HEAD_SHOULDERS · DOUBLE_BOTTOM · DOUBLE_TOP
//    plus tick-level ORB and MOMENTUM
//  - every signal carries explicit entry / SL / target levels on the spot price
//  - optionally auto-places: equity market orders for stocks, ATM option
//    (CE on LONG / PE on SHORT) for indices, then manages SL / target /
//    timed square-off and premium P&L for index trades

import { db } from "@/lib/db";
import { SCAN_ASSETS, SCAN_ASSET_MAP, getScanAsset, type ScanAsset } from "./stocks";
import { gaussian, roundTick, paperPremium } from "./pricing";
import { istNow, isMarketOpen, hhmmToMinutes } from "./market";
import { shoonyaLogin, shoonyaQuote, shoonyaPlaceOrder, ShoonyaCreds } from "./shoonya";
import {
  INSTRUMENTS,
  optionSymbol,
  resolveExpiry,
  roundStrike,
  type InstrumentId,
} from "./instruments";
import {
  PATTERN_DEFS,
  runPatternDetectors,
  validStrategyIds,
  type Candle,
  type PatternId,
} from "./patterns";

const SCAN_TICK_MS = 5000;
const SLIPPAGE = 0.0005; // 0.05% adverse paper fill on cash entries
const ORB_TICKS = 15; // ticks forming the opening range (~75s in sim)
const MOMENTUM_WARMUP_TICKS = 10;
const MOMENTUM_THRESHOLD = 0.005; // 0.5% move from day open
const ERROR_THROTTLE_MS = 5 * 60 * 1000;
const MAX_CANDLES = 320;
const BACKFILL_BARS = 150; // paper-mode seeded history so patterns can fire immediately
const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

interface CandleState {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  n: number;
}

interface ScannerState {
  prices: Map<string, number>;
  dayOpen: Map<string, number>;
  orbHigh: Map<string, number>;
  orbLow: Map<string, number>;
  orbTicks: Map<string, number>;
  candles: Map<string, Candle[]>;
  cur: Map<string, CandleState>;
  backfilled: Set<string>;
  day: string;
  cooldown: Set<string>; // `${symbol}` signaled today
  lastErrorAt: number;
  ticking: boolean;
  session: { token: string; actid: string; userId: string } | null;
}

const g = globalThis as unknown as { __shoonyaAlgoScanner?: Scanner };

const SCANNER_VERSION = 4;

export interface ScannerUniverseRow {
  symbol: string;
  name: string;
  kind: "INDEX" | "EQUITY";
  price: number;
  dayOpen: number;
  chgPct: number;
  orbHigh: number | null;
  orbLow: number | null;
  rangeReady: boolean;
  bars: number;
  enabled: boolean;
  state: "SCANNING" | "IN_TRADE" | "COOLDOWN" | "IDLE";
}

export interface ScanTradeSpec {
  strategy: string;
  side: "LONG" | "SHORT";
  entry: number; // spot level entry
  sl: number; // spot level SL
  target: number; // spot level target
  ref: number; // structural reference level
  note: string;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Parse a scanner-executed option tradingsymbol back into its parts. */
function parseExecSymbol(tsym: string):
  | { instId: InstrumentId; strike: number; type: "CE" | "PE"; settleMs: number }
  | null {
  const m = tsym.match(/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX)(\d{2})([A-Z]{3})(\d{2})(\d+)(CE|PE)$/);
  if (!m) return null;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const mi = months.indexOf(m[3]);
  if (mi < 0) return null;
  const settleMs = Date.UTC(2000 + parseInt(m[4], 10), mi, parseInt(m[2], 10), 10, 0, 0);
  return {
    instId: m[1] as InstrumentId,
    strike: parseFloat(m[5]),
    type: m[6] as "CE" | "PE",
    settleMs,
  };
}

class Scanner {
  readonly codeVersion = SCANNER_VERSION;
  private state: ScannerState = {
    prices: new Map(),
    dayOpen: new Map(),
    orbHigh: new Map(),
    orbLow: new Map(),
    orbTicks: new Map(),
    candles: new Map(),
    cur: new Map(),
    backfilled: new Set(),
    day: "",
    cooldown: new Set(),
    lastErrorAt: 0,
    ticking: false,
    session: null,
  };
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.timer) return;
    for (const a of SCAN_ASSETS) this.state.prices.set(a.symbol, a.basePrice);
    console.log(`[scanner] started v${this.codeVersion} (${SCAN_ASSETS.length} symbols incl. indices)`);
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error("[scanner] tick error:", e));
    }, SCAN_TICK_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  price(symbol: string): number {
    return this.state.prices.get(symbol) ?? SCAN_ASSET_MAP[symbol]?.basePrice ?? 0;
  }

  private rollDay(day: string) {
    if (this.state.day !== day) {
      this.state.day = day;
      this.state.dayOpen.clear();
      this.state.orbHigh.clear();
      this.state.orbLow.clear();
      this.state.orbTicks.clear();
      this.state.cooldown.clear();
      this.state.candles.clear();
      this.state.cur.clear();
      this.state.backfilled.clear();
    }
  }

  private walk() {
    for (const a of SCAN_ASSETS) {
      const p = this.state.prices.get(a.symbol) ?? a.basePrice;
      // ~0.08% of price per 5s tick scaled by each symbol's vol -> candles move
      const next = p + (a.basePrice - p) * 0.0004 + p * a.vol * 0.0035 * gaussian();
      const snapped = round2(next);
      this.state.prices.set(a.symbol, snapped);
      if (!this.state.dayOpen.has(a.symbol)) this.state.dayOpen.set(a.symbol, snapped);
    }
  }

  // ---------- candles ----------

  /** Seed paper candle history (bridged random walk ending at the current price). */
  private backfill(sym: string, asset: ScanAsset, candleSec: number) {
    const key = `${sym}:${candleSec}`;
    if (this.state.backfilled.has(key)) return;
    this.state.backfilled.add(key);
    const price = this.price(sym) || asset.basePrice;
    const sigma = (price * asset.vol) / Math.sqrt(252 * 375) * Math.sqrt(candleSec / 60);
    const steps: number[] = [0];
    let cum = 0;
    for (let i = 1; i <= BACKFILL_BARS; i++) {
      cum += gaussian();
      steps.push(cum);
    }
    const rawN = steps[BACKFILL_BARS];
    const candles: Candle[] = [];
    const nowMs = Date.now();
    const grid = Math.floor(nowMs / (candleSec * 1000)) * candleSec * 1000;
    let prev = price; // bridged series ends exactly at the current price
    for (let i = 1; i <= BACKFILL_BARS; i++) {
      const c = price + (steps[i] - (i / BACKFILL_BARS) * rawN) * sigma;
      const o = prev;
      const wickUp = Math.abs(gaussian()) * sigma * 0.5;
      const wickDn = Math.abs(gaussian()) * sigma * 0.5;
      candles.push({
        t: grid - (BACKFILL_BARS - i) * candleSec * 1000,
        o: round2(o),
        h: round2(Math.max(o, c) + wickUp),
        l: round2(Math.min(o, c) - wickDn),
        c: round2(c),
      });
      prev = c;
    }
    this.state.candles.set(sym, candles);
  }

  /** Append a price tick to the in-progress candle; returns true when a candle just closed. */
  private appendTick(sym: string, price: number, candleSec: number): boolean {
    const nowMs = Date.now();
    const start = Math.floor(nowMs / (candleSec * 1000)) * candleSec * 1000;
    const cur = this.state.cur.get(sym);
    if (!cur || cur.t !== start) {
      if (cur && cur.n > 0) {
        const arr = this.state.candles.get(sym) ?? [];
        arr.push({ t: cur.t, o: cur.o, h: cur.h, l: cur.l, c: cur.c });
        if (arr.length > MAX_CANDLES) arr.splice(0, arr.length - MAX_CANDLES);
        this.state.candles.set(sym, arr);
        this.state.cur.delete(sym);
        // start the new candle
        this.state.cur.set(sym, { t: start, o: price, h: price, l: price, c: price, n: 1 });
        return true;
      }
      this.state.cur.set(sym, { t: start, o: price, h: price, l: price, c: price, n: 1 });
      return false;
    }
    cur.h = Math.max(cur.h, price);
    cur.l = Math.min(cur.l, price);
    cur.c = price;
    cur.n++;
    return false;
  }

  // ---------- live quotes ----------
  private async ensureSession(): Promise<boolean> {
    if (this.state.session) return true;
    const acct = await db.brokerAccount.findUnique({ where: { id: "shoonya" } });
    if (!acct || !acct.userId || !acct.password || !acct.apiKey) return false;
    const creds: ShoonyaCreds = {
      userId: acct.userId,
      password: acct.password,
      factor2: acct.factor2 ?? "",
      vendorCode: acct.vendorCode ?? "",
      apiKey: acct.apiKey,
      imei: acct.imei ?? "shoonyaalgo",
      totpSecret: acct.totpSecret,
    };
    const res = await shoonyaLogin(creds);
    if (res.ok && res.token) {
      this.state.session = { token: res.token, actid: res.account ?? acct.userId, userId: acct.userId };
      return true;
    }
    return false;
  }

  private throttleError(message: string) {
    const now = Date.now();
    if (now - this.state.lastErrorAt < ERROR_THROTTLE_MS) return;
    this.state.lastErrorAt = now;
    void db.event
      .create({ data: { deploymentId: null, type: "ERROR", message, level: "ERROR" } })
      .catch(() => {});
  }

  // ---------- index option helpers ----------

  /** ATM option chosen for a directional index trade (CE on LONG, PE on SHORT). */
  private indexExecution(
    instId: InstrumentId,
    spot: number,
    side: "LONG" | "SHORT",
    now: Date,
  ): { execSymbol: string; exchange: "NFO" | "BFO"; execQty: number; strike: number; type: "CE" | "PE"; settleMs: number; lotSize: number; iv: number } | null {
    const inst = INSTRUMENTS[instId];
    if (!inst) return null;
    const expiry = resolveExpiry(inst, "NEAREST", now).date;
    const settleMs = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate(), 10, 0, 0);
    const strike = roundStrike(spot, inst.strikeStep);
    const type = side === "LONG" ? "CE" : "PE";
    return {
      execSymbol: optionSymbol(inst, expiry, strike, type),
      exchange: inst.exchange,
      execQty: inst.lotSize, // 1 lot; sized up below if capital allows
      strike,
      type,
      settleMs,
      lotSize: inst.lotSize,
      iv: inst.iv,
    };
  }

  private bsPremiumFor(exec: NonNullable<ReturnType<Scanner["indexExecution"]>>, spot: number): number {
    const T = Math.max((exec.settleMs - Date.now()) / MS_PER_YEAR, 0);
    return roundTick(paperPremium({ spot, strike: exec.strike, iv: exec.iv, yearsToExpiry: T, type: exec.type }));
  }

  // ---------- main tick ----------
  async tick(): Promise<void> {
    if (this.state.ticking) return;
    this.state.ticking = true;
    try {
      const now = istNow();
      this.rollDay(`${now.yyyy}-${now.mm}-${now.dd}`);
      const marketOpen = isMarketOpen(now);

      const config = await db.scannerConfig.findUnique({ where: { id: "global" } });
      if (!config) return;

      const enabledSymbols = config.symbols
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SCAN_ASSET_MAP[s] !== undefined);

      const live = config.mode === "LIVE";
      const candleSec = Math.max(15, Math.min(300, config.candleSeconds || 60));

      // ---------- price source ----------
      if (live && enabledSymbols.length > 0) {
        const ok = await this.ensureSession();
        if (!ok) {
          this.throttleError("Scanner LIVE mode: no broker session — quotes unavailable. Configure Shoonya credentials in Settings.");
          return;
        }
        const results = await Promise.all(
          enabledSymbols.map(async (sym) => {
            const asset = SCAN_ASSET_MAP[sym];
            const lp =
              asset?.kind === "INDEX"
                ? await shoonyaQuote(this.state.session!.token, this.state.session!.userId, asset.exchange ?? "NFO", sym)
                : await shoonyaQuote(this.state.session!.token, this.state.session!.userId, "NSE", `${sym}-EQ`);
            return [sym, lp] as const;
          }),
        );
        let anyQuote = false;
        for (const [sym, lp] of results) {
          if (lp !== null && lp > 0) {
            this.state.prices.set(sym, lp);
            if (!this.state.dayOpen.has(sym)) this.state.dayOpen.set(sym, lp);
            anyQuote = true;
          }
        }
        if (!anyQuote) {
          this.throttleError("Scanner LIVE mode: quotes unreachable from this machine. Check network / broker session.");
          return;
        }
      } else {
        // paper (and pre-warm of sim sessions): walk simulated prices
        this.walk();
      }

      if (!config.enabled || enabledSymbols.length === 0) return;

      // ---------- manage open scan trades ----------
      await this.manageOpenTrades(config, now, marketOpen);

      // ---------- candle building ----------
      const freshlyClosed = new Set<string>();
      for (const sym of enabledSymbols) {
        const asset = SCAN_ASSET_MAP[sym];
        if (!asset) continue;
        const price = this.price(sym);
        if (!price) continue;
        if (!live) this.backfill(sym, asset, candleSec);
        if (this.appendTick(sym, price, candleSec)) freshlyClosed.add(sym);
      }

      // ---------- evaluate signals ----------
      const openTrades = await db.scanTrade.findMany({ where: { status: "OPEN" } });
      const inTrade = new Set(openTrades.map((t) => t.symbol));

      let strategies: string[] = [];
      try {
        const parsed = JSON.parse(config.strategies) as unknown;
        if (Array.isArray(parsed)) strategies = parsed.filter((s) => validStrategyIds().includes(String(s)));
      } catch {
        strategies = ["ORB"];
      }
      if (config.strategy === "MOMENTUM" && strategies.length === 1 && strategies[0] === "ORB") strategies = ["MOMENTUM"];
      const patternIds = strategies.filter((s) => !["ORB", "MOMENTUM"].includes(s)) as PatternId[];
      let overrides: Record<string, Record<string, number>> = {};
      try {
        overrides = JSON.parse(config.patternParams) as typeof overrides;
      } catch {
        overrides = {};
      }

      for (const sym of enabledSymbols) {
        const asset = getScanAsset(sym);
        if (!asset) continue;
        const price = this.price(sym);
        const open = this.state.dayOpen.get(sym);
        if (!open) continue;

        // opening-range bookkeeping (ORB / momentum use tick ranges)
        const t = (this.state.orbTicks.get(sym) ?? 0) + 1;
        this.state.orbTicks.set(sym, t);
        if (t <= ORB_TICKS) {
          this.state.orbHigh.set(sym, Math.max(this.state.orbHigh.get(sym) ?? price, price));
          this.state.orbLow.set(sym, Math.min(this.state.orbLow.get(sym) ?? price, price));
        }

        if (this.state.cooldown.has(sym) || inTrade.has(sym)) continue;

        // ----- pattern signals (candle based) -----
        if (patternIds.length > 0 && freshlyClosed.has(sym)) {
          const candles = this.state.candles.get(sym) ?? [];
          const sigs = runPatternDetectors(candles, patternIds, overrides);
          if (sigs.length > 0) {
            const s = sigs[0];
            await this.fireSignal(config, asset, sym, {
              strategy: s.strategy,
              side: s.side,
              entry: round2(s.entry),
              sl: round2(s.sl),
              target: round2(s.target),
              ref: round2(s.ref),
              note: s.note,
            });
            continue;
          }
        }

        // ----- base strategies (tick based) -----
        let spec: ScanTradeSpec | null = null;
        if (strategies.includes("ORB")) {
          if (t > ORB_TICKS) {
            const hi = this.state.orbHigh.get(sym);
            const lo = this.state.orbLow.get(sym);
            if (hi && lo) {
              const b = round2(price * 0.0005);
              if (price > hi + b) {
                spec = {
                  strategy: "ORB",
                  side: "LONG",
                  entry: round2(price),
                  sl: round2(price * (1 - config.slPct / 100)),
                  target: round2(price * (1 + config.targetPct / 100)),
                  ref: round2(hi),
                  note: `Broke above opening range high ₹${hi.toFixed(2)} (range ₹${lo.toFixed(2)}–₹${hi.toFixed(2)}).`,
                };
              } else if (price < lo - b) {
                spec = {
                  strategy: "ORB",
                  side: "SHORT",
                  entry: round2(price),
                  sl: round2(price * (1 + config.slPct / 100)),
                  target: round2(price * (1 - config.targetPct / 100)),
                  ref: round2(lo),
                  note: `Broke below opening range low ₹${lo.toFixed(2)} (range ₹${lo.toFixed(2)}–₹${hi.toFixed(2)}).`,
                };
              }
            }
          }
        } else if (strategies.includes("MOMENTUM") && spec === null) {
          if (t > MOMENTUM_WARMUP_TICKS) {
            const chg = price / open - 1;
            if (chg >= MOMENTUM_THRESHOLD) {
              spec = {
                strategy: "MOMENTUM",
                side: "LONG",
                entry: round2(price),
                sl: round2(price * (1 - config.slPct / 100)),
                target: round2(price * (1 + config.targetPct / 100)),
                ref: round2(open),
                note: `Up ${((price / open - 1) * 100).toFixed(2)}% from day open — momentum continuation.`,
              };
            } else if (chg <= -MOMENTUM_THRESHOLD) {
              spec = {
                strategy: "MOMENTUM",
                side: "SHORT",
                entry: round2(price),
                sl: round2(price * (1 + config.slPct / 100)),
                target: round2(price * (1 - config.targetPct / 100)),
                ref: round2(open),
                note: `Down ${(Math.abs(chg) * 100).toFixed(2)}% from day open — momentum breakdown.`,
              };
            }
          }
        }
        if (spec) await this.fireSignal(config, asset, sym, spec);
      }
    } finally {
      this.state.ticking = false;
    }
  }

  /** Record a signal and (optionally) place the trade with explicit spot levels. */
  private async fireSignal(
    config: {
      autoPlace: boolean;
      mode: string;
      capitalPerTrade: number;
    },
    asset: ScanAsset,
    sym: string,
    spec: ScanTradeSpec,
  ) {
    this.state.cooldown.add(sym);
    let placed = false;
    let tradeId: string | null = null;

    if (config.autoPlace) placed = true; // set false again if execution fails outright

    let tradeRow: { id: string } | null = null;
    if (config.autoPlace) {
      try {
        tradeRow = await this.openScanTrade(config, asset, sym, spec);
        tradeId = tradeRow?.id ?? null;
        placed = tradeRow !== null;
      } catch (e) {
        console.error("[scanner] trade placement failed:", e);
        placed = false;
      }
    }

    await db.scanSignal.create({
      data: {
        symbol: sym,
        strategy: spec.strategy,
        side: spec.side,
        refPrice: spec.ref,
        price: spec.entry,
        entryLevel: spec.entry,
        slLevel: spec.sl,
        targetLevel: spec.target,
        note: spec.note,
        placed,
        tradeId,
      },
    });
  }

  /** Create the ScanTrade (equity cash or index ATM option) for a signal. */
  private async openScanTrade(
    config: { mode: string; capitalPerTrade: number },
    asset: ScanAsset,
    sym: string,
    spec: ScanTradeSpec,
  ): Promise<{ id: string } | null> {
    const now = new Date();
    let qty = 0;
    let execSymbol: string | null = null;
    let execQty = 0;
    let entryPremium: number | null = null;
    let orderTsyl = `${sym}-EQ`;
    let orderExchange = "NSE";
    let orderPrice = spec.entry;
    let execDesc = `${sym} × qty`;

    if (asset.kind === "INDEX") {
      const instId = sym as InstrumentId;
      const exec = this.indexExecution(instId, spec.entry, spec.side, now);
      if (!exec) return null;
      const est = this.bsPremiumFor(exec, spec.entry);
      // live: prefer the real option LTP when available
      let premium = est;
      if (config.mode === "LIVE" && this.state.session) {
        const lp = await shoonyaQuote(this.state.session.token, this.state.session.userId, exec.exchange, exec.execSymbol).catch(() => null);
        if (lp && lp > 0) premium = lp;
      }
      const lots = Math.max(1, Math.floor(config.capitalPerTrade / Math.max(1, premium * exec.lotSize)));
      execQty = lots * exec.lotSize;
      execSymbol = exec.execSymbol;
      entryPremium = premium;
      qty = 0;
      orderTsyl = exec.execSymbol;
      orderExchange = exec.exchange;
      orderPrice = premium;
      execDesc = `${exec.execSymbol} × ${execQty} (${lots} lot${lots > 1 ? "s" : ""}) @ ₹${premium.toFixed(2)}`;
    } else {
      qty = Math.max(1, Math.floor(config.capitalPerTrade / spec.entry));
      execDesc = `${sym} × ${qty}`;
    }

    const entry = asset.kind === "EQUITY" ? roundTick(spec.entry * (1 + (spec.side === "LONG" ? SLIPPAGE : -SLIPPAGE))) : round2(spec.entry);

    const trade = await db.scanTrade.create({
      data: {
        symbol: sym,
        kind: asset.kind,
        strategy: spec.strategy,
        side: spec.side,
        qty,
        entryPrice: entry,
        ltp: entry,
        slPrice: spec.sl,
        targetPrice: spec.target,
        execSymbol,
        execQty,
        entryPremium,
        ltpPremium: entryPremium,
        mode: config.mode,
        status: "OPEN",
      },
    });

    await db.order.create({
      data: {
        deploymentId: null,
        tsym: orderTsyl,
        exchange: orderExchange,
        side: spec.side === "LONG" ? "B" : "S",
        qty: asset.kind === "EQUITY" ? qty : execQty,
        price: orderPrice,
        priceType: "MKT",
        mode: config.mode,
        status: "FILLED",
        message:
          config.mode === "LIVE"
            ? `Live scanner order placed (${execDesc})`
            : `Scanner paper fill @ ${asset.kind === "INDEX" ? `₹${(entryPremium ?? 0).toFixed(2)} prem` : `₹${entry.toFixed(2)}`}`,
      },
    });
    await db.event
      .create({
        data: {
          deploymentId: null,
          type: "SCAN_ENTRY",
          level: "TRADE",
          message: `Scanner ${config.mode} ${spec.side} ${sym} (${spec.strategy}) entry ₹${spec.entry.toFixed(2)} — SL ₹${spec.sl.toFixed(2)}, target ₹${spec.target.toFixed(2)}. Exec: ${execDesc}.`,
        },
      })
      .catch(() => {});

    if (config.mode === "LIVE" && this.state.session) {
      // fire the real order (best effort; fills tracked via broker)
      await shoonyaPlaceOrder(
        this.state.session.token,
        this.state.session.actid,
        this.state.session.userId,
        {
          exchange: orderExchange,
          symbol: orderTsyl,
          qty: asset.kind === "EQUITY" ? qty : execQty,
          side: spec.side === "LONG" ? "B" : "S",
          price: 0,
          priceType: "MKT",
          product: asset.kind === "EQUITY" ? "I" : "M",
          remarks: "SA-SCAN",
        },
      ).catch(() => null);
    }

    return { id: trade.id };
  }

  // ---------- trade management ----------

  private async manageOpenTrades(
    config: { slPct: number; targetPct: number; squareOffTime: string; mode: string },
    now: ReturnType<typeof istNow>,
    marketOpen: boolean,
  ) {
    const open = await db.scanTrade.findMany({ where: { status: "OPEN" } });
    const nowMin = now.hh * 60 + now.minute;
    const soMin = hhmmToMinutes(config.squareOffTime);

    for (const trade of open) {
      const spot = this.price(trade.symbol);
      if (!spot) continue;
      const isIndex = trade.kind === "INDEX";

      let closeStatus: string | null = null;
      let closeMsg = "";
      if (
        trade.slPrice &&
        ((trade.side === "LONG" && spot <= trade.slPrice) || (trade.side === "SHORT" && spot >= trade.slPrice))
      ) {
        closeStatus = "CLOSED_SL";
        closeMsg = `Stop-loss level ₹${trade.slPrice.toFixed(2)} hit`;
      } else if (
        trade.targetPrice &&
        ((trade.side === "LONG" && spot >= trade.targetPrice) || (trade.side === "SHORT" && spot <= trade.targetPrice))
      ) {
        closeStatus = "CLOSED_TARGET";
        closeMsg = `Target level ₹${trade.targetPrice.toFixed(2)} reached`;
      } else if (marketOpen && nowMin >= soMin) {
        closeStatus = "CLOSED_TIME";
        closeMsg = `Timed square-off at ${config.squareOffTime} IST`;
      }

      if (closeStatus) {
        const exit = isIndex ? round2(spot) : roundTick(spot * (1 + (trade.side === "LONG" ? -SLIPPAGE : SLIPPAGE)));
        let exitPremium: number | null = null;
        let pnl = 0;
        if (isIndex && trade.execSymbol && trade.entryPremium) {
          const parsed = parseExecSymbol(trade.execSymbol);
          if (parsed) {
            const inst = INSTRUMENTS[parsed.instId];
            const exec = {
              execSymbol: trade.execSymbol,
              exchange: inst.exchange,
              execQty: trade.execQty,
              strike: parsed.strike,
              type: parsed.type,
              settleMs: parsed.settleMs,
              lotSize: inst.lotSize,
              iv: inst.iv,
            };
            exitPremium = this.bsPremiumFor(exec, spot);
            if (config.mode === "LIVE" && this.state.session) {
              const lp = await shoonyaQuote(this.state.session.token, this.state.session.userId, inst.exchange, trade.execSymbol).catch(() => null);
              if (lp && lp > 0) exitPremium = lp;
            }
            pnl = Math.round((exitPremium - trade.entryPremium) * trade.execQty * 100) / 100;
          }
        } else {
          pnl = Math.round((trade.side === "LONG" ? 1 : -1) * (exit - trade.entryPrice) * trade.qty * 100) / 100;
        }
        await db.scanTrade.update({
          where: { id: trade.id },
          data: {
            status: closeStatus,
            exitPrice: exit,
            ltp: exit,
            exitPremium,
            ltpPremium: exitPremium,
            realizedPnl: pnl,
            closedAt: new Date(),
          },
        });
        await db.order.create({
          data: {
            deploymentId: null,
            tsym: isIndex && trade.execSymbol ? trade.execSymbol : `${trade.symbol}-EQ`,
            exchange: isIndex ? INSTRUMENTS[trade.symbol as InstrumentId]?.exchange ?? "NFO" : "NSE",
            side: trade.side === "LONG" ? "S" : "B",
            qty: isIndex ? trade.execQty : trade.qty,
            price: isIndex ? exitPremium ?? 0 : exit,
            priceType: "MKT",
            mode: trade.mode,
            status: "FILLED",
            message: `Scanner exit (${closeStatus}) @ ${isIndex ? `₹${(exitPremium ?? 0).toFixed(2)} prem` : `₹${exit.toFixed(2)}`}`,
          },
        });
        await db.event
          .create({
            data: {
              deploymentId: null,
              type: "SCAN_EXIT",
              level: "TRADE",
              message: `Scanner ${trade.side} ${trade.symbol} closed — ${closeMsg}. P&L ₹${pnl.toLocaleString("en-IN")}.`,
            },
          })
          .catch(() => {});
      } else {
        const upd: Record<string, number> = {};
        if (trade.ltp !== spot) upd.ltp = spot;
        if (isIndex && trade.execSymbol) {
          const parsed = parseExecSymbol(trade.execSymbol);
          if (parsed) {
            const inst = INSTRUMENTS[parsed.instId];
            const prem = this.bsPremiumFor(
              {
                execSymbol: trade.execSymbol,
                exchange: inst.exchange,
                execQty: trade.execQty,
                strike: parsed.strike,
                type: parsed.type,
                settleMs: parsed.settleMs,
                lotSize: inst.lotSize,
                iv: inst.iv,
              },
              spot,
            );
            if (prem !== trade.ltpPremium) upd.ltpPremium = prem;
          }
        }
        if (Object.keys(upd).length > 0) {
          await db.scanTrade.update({ where: { id: trade.id }, data: upd });
        }
      }
    }
    void config;
  }

  // ---------- manual ops ----------
  async closeTrade(tradeId: string, reason = "CLOSED_MANUAL") {
    const trade = await db.scanTrade.findUnique({ where: { id: tradeId } });
    if (!trade || trade.status !== "OPEN") return;
    const spot = this.price(trade.symbol) || trade.ltp || trade.entryPrice;
    const isIndex = trade.kind === "INDEX";
    const exit = isIndex ? round2(spot) : roundTick(spot * (1 + (trade.side === "LONG" ? -SLIPPAGE : SLIPPAGE)));
    let exitPremium: number | null = null;
    let pnl = 0;
    if (isIndex && trade.execSymbol && trade.entryPremium) {
      const parsed = parseExecSymbol(trade.execSymbol);
      if (parsed) {
        const inst = INSTRUMENTS[parsed.instId];
        exitPremium = this.bsPremiumFor(
          {
            execSymbol: trade.execSymbol,
            exchange: inst.exchange,
            execQty: trade.execQty,
            strike: parsed.strike,
            type: parsed.type,
            settleMs: parsed.settleMs,
            lotSize: inst.lotSize,
            iv: inst.iv,
          },
          spot,
        );
        pnl = Math.round((exitPremium - trade.entryPremium) * trade.execQty * 100) / 100;
      }
    } else {
      pnl = Math.round((trade.side === "LONG" ? 1 : -1) * (exit - trade.entryPrice) * trade.qty * 100) / 100;
    }
    await db.scanTrade.update({
      where: { id: trade.id },
      data: {
        status: reason,
        exitPrice: exit,
        ltp: exit,
        exitPremium,
        ltpPremium: exitPremium,
        realizedPnl: pnl,
        closedAt: new Date(),
      },
    });
    await db.order.create({
      data: {
        deploymentId: null,
        tsym: isIndex && trade.execSymbol ? trade.execSymbol : `${trade.symbol}-EQ`,
        exchange: isIndex ? INSTRUMENTS[trade.symbol as InstrumentId]?.exchange ?? "NFO" : "NSE",
        side: trade.side === "LONG" ? "S" : "B",
        qty: isIndex ? trade.execQty : trade.qty,
        price: isIndex ? exitPremium ?? 0 : exit,
        priceType: "MKT",
        mode: trade.mode,
        status: "FILLED",
        message: `Scanner manual exit @ ${isIndex ? `₹${(exitPremium ?? 0).toFixed(2)} prem` : `₹${exit.toFixed(2)}`}`,
      },
    });
    await db.event
      .create({
        data: {
          deploymentId: null,
          type: "SCAN_EXIT",
          level: "TRADE",
          message: `Scanner ${trade.side} ${trade.symbol} closed manually @ ${isIndex ? `₹${(exitPremium ?? 0).toFixed(2)} prem` : `₹${exit.toFixed(2)}`}. P&L ₹${pnl.toLocaleString("en-IN")}.`,
        },
      })
      .catch(() => {});
  }

  /** Re-arm the simulated day: forget opens, ranges, candles and signal cooldowns. */
  resetDay() {
    this.state.dayOpen.clear();
    this.state.orbHigh.clear();
    this.state.orbLow.clear();
    this.state.orbTicks.clear();
    this.state.cooldown.clear();
    this.state.candles.clear();
    this.state.cur.clear();
    this.state.backfilled.clear();
  }

  universe(enabledSet: Set<string>, inTradeSet: Set<string>): ScannerUniverseRow[] {
    const rows: ScannerUniverseRow[] = [];
    for (const a of SCAN_ASSETS) {
      const price = this.price(a.symbol);
      const open = this.state.dayOpen.get(a.symbol) ?? price;
      const hi = this.state.orbHigh.get(a.symbol) ?? null;
      const lo = this.state.orbLow.get(a.symbol) ?? null;
      const ticks = this.state.orbTicks.get(a.symbol) ?? 0;
      let state: ScannerUniverseRow["state"] = "IDLE";
      if (inTradeSet.has(a.symbol)) state = "IN_TRADE";
      else if (this.state.cooldown.has(a.symbol)) state = "COOLDOWN";
      else if (enabledSet.has(a.symbol)) state = "SCANNING";
      rows.push({
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        price: Math.round(price * 100) / 100,
        dayOpen: Math.round(open * 100) / 100,
        chgPct: open ? Math.round((price / open - 1) * 10000) / 100 : 0,
        orbHigh: hi,
        orbLow: lo,
        rangeReady: ticks > ORB_TICKS,
        bars: (this.state.candles.get(a.symbol) ?? []).length,
        enabled: enabledSet.has(a.symbol),
        state,
      });
    }
    return rows;
  }

  sessionInfo() {
    return this.state.session !== null;
  }

  patternCount() {
    return PATTERN_DEFS.length;
  }
}

export function getScanner(): Scanner {
  const existing = g.__shoonyaAlgoScanner;
  if (existing && existing.codeVersion === SCANNER_VERSION) return existing;
  if (existing) {
    try {
      existing.stop();
    } catch {
      /* ignore */
    }
  }
  const fresh = new Scanner();
  g.__shoonyaAlgoScanner = fresh;
  fresh.start();
  return fresh;
}
