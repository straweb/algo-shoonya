// ShoonyaAlgo execution engine.
// A singleton tick-loop (3s) that:
//  - walks the simulated spot for paper mode
//  - enters deployments at their entry time (index options, nearest/next expiry)
//  - monitors per-leg SL, deployment target, day max-loss kill switch, timed exit
//  - in LIVE mode routes orders through the Shoonya Noren REST API

import { db } from "@/lib/db";
import { getInstrument, resolveExpiry, INSTRUMENT_LIST, InstrumentId, optionSymbol } from "./instruments";
import { getStrategy } from "./strategies";
import { buildLegs } from "./plan";
import { blackScholes, gaussian, roundTick } from "./pricing";
import { istNow, isMarketOpen, hhmmToMinutes } from "./market";
import { shoonyaLogin, shoonyaPlaceOrder, shoonyaQuote, ShoonyaCreds } from "./shoonya";
import { getScanner } from "./scanner";

const TICK_MS = 3000;
const TICK_VOL = 0.0002; // ~0.02% per 3s tick  ->  ~2% intraday
const SLIPPAGE = 0.0025; // 0.25% adverse paper fill
const ERROR_EVENT_THROTTLE_MS = 5 * 60 * 1000;

export interface LegLike {
  id: string;
  symbol: string;
  exchange: string;
  status: string;
  strike: number;
  optionType: string;
  side: string;
  qty: number;
  entryPrice: number | null;
  exitPrice: number | null;
  ltp: number | null;
  slPrice: number | null;
  expiryDate: string | null;
}

export interface DeployLike {
  id: string;
  instrument: string;
  strategyType: string;
  mode: string;
  status: string;
  direction: string;
  expiryMode: string;
  expiryDate: string | null;
  lots: number;
  otmGap: number;
  wingGap: number;
  entryTime: string;
  squareOffTime: string;
  legSlPct: number;
  targetProfit: number | null;
  realizedPnl: number;
  legs: LegLike[];
}

interface RuntimeState {
  spots: Map<InstrumentId, number>;
  dayOpens: Map<InstrumentId, number>;
  paperDay: string;
  lastErrorAt: Map<string, number>;
  liveFailCount: number;
  ticking: boolean;
}

const g = globalThis as unknown as { __shoonyaAlgoEngine?: Engine };

// Bump whenever engine logic changes — dev hot-reload & per-route module bundles
// can leave stale instances behind; version check guarantees the live code wins.
const ENGINE_VERSION = 2;

class Engine {
  readonly codeVersion = ENGINE_VERSION;
  private state: RuntimeState = {
    spots: new Map(),
    dayOpens: new Map(),
    paperDay: "",
    lastErrorAt: new Map(),
    liveFailCount: 0,
    ticking: false,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  brokerSession: { token: string; actid: string; userId: string } | null = null;

  start() {
    if (this.timer) return;
    for (const inst of INSTRUMENT_LIST) this.state.spots.set(inst.id, inst.basePrice);
    console.log(`[engine] started v${this.codeVersion} instance`);
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error("[engine] tick error:", e));
    }, TICK_MS);
    void this.tick().catch((e) => console.error("[engine] tick error:", e));
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  spot(instId: InstrumentId): number {
    return this.state.spots.get(instId) ?? getInstrument(instId).basePrice;
  }

  dayOpen(instId: InstrumentId): number {
    return this.state.dayOpens.get(instId) ?? this.spot(instId);
  }

  private rollPaperDay(day: string) {
    if (this.state.paperDay !== day) {
      this.state.paperDay = day;
      this.state.dayOpens.clear();
    }
  }

  private walkSpots() {
    for (const inst of INSTRUMENT_LIST) {
      const s = this.state.spots.get(inst.id) ?? inst.basePrice;
      // mean-reverting geometric walk around basePrice
      const next = s + (inst.basePrice - s) * 0.0015 + s * TICK_VOL * gaussian();
      const snapped = Math.round(next * 100) / 100;
      this.state.spots.set(inst.id, snapped);
      if (!this.state.dayOpens.has(inst.id)) this.state.dayOpens.set(inst.id, snapped);
    }
  }

  // ---------- events ----------
  private async logEvent(
    deploymentId: string | null,
    type: string,
    message: string,
    level: string = "INFO",
  ) {
    try {
      await db.event.create({ data: { deploymentId, type, message, level } });
    } catch {
      /* ignore */
    }
  }

  private async logThrottledError(deploymentId: string, message: string) {
    const last = this.state.lastErrorAt.get(deploymentId) ?? 0;
    if (Date.now() - last < ERROR_EVENT_THROTTLE_MS) return;
    this.state.lastErrorAt.set(deploymentId, Date.now());
    await this.logEvent(deploymentId, "ERROR", message, "ERROR");
  }

  // ---------- broker ----------
  private async ensureBroker(): Promise<boolean> {
    if (this.brokerSession) return true;
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
      this.brokerSession = { token: res.token, actid: res.account ?? acct.userId, userId: acct.userId };
      await db.brokerAccount.update({
        where: { id: "shoonya" },
        data: {
          sessionToken: res.token,
          lastLoginAt: new Date(),
          lastStatus: "CONNECTED",
          lastError: null,
          accountId: res.account ?? acct.userId,
        },
      });
      await this.logEvent(null, "BROKER", "Shoonya session established (live mode active).");
      return true;
    }
    await db.brokerAccount.update({
      where: { id: "shoonya" },
      data: { lastStatus: "ERROR", lastError: res.error ?? "Login failed" },
    });
    await this.logEvent(null, "BROKER", `Shoonya login failed: ${res.error}`, "ERROR");
    return false;
  }

  async brokerLogout() {
    this.brokerSession = null;
  }

  // ---------- main tick ----------
  async tick(): Promise<void> {
    if (this.state.ticking) return;
    this.state.ticking = true;
    try {
      const now = istNow();
      this.rollPaperDay(`${now.yyyy}-${now.mm}-${now.dd}`);
      const marketOpen = isMarketOpen(now);

      const settings = await db.settings.findUnique({ where: { id: "global" } });
      const paperSim = settings?.paperSimulate ?? true;
      if (marketOpen || paperSim) this.walkSpots();

      const running = await db.deployment.findMany({
        where: { status: { in: ["RUNNING", "PAUSED"] } },
        include: { legs: true },
      });
      if (running.length === 0) return;

      const dayMaxLoss = settings?.dayMaxLoss ?? 10000;

      // live legs needing quotes
      const liveLegs = running
        .flatMap((d) => d.legs.filter((l) => d.mode === "LIVE" && l.status === "OPEN"))
        .map((l) => ({ exchange: l.exchange, symbol: l.symbol }));
      const quotes = new Map<string, number>();
      if (liveLegs.length > 0 && (await this.ensureBroker())) {
        const uniq = Array.from(new Set(liveLegs.map((l) => `${l.exchange}|${l.symbol}`)));
        const results = await Promise.all(
          uniq.map(async (k) => {
            const [exchange, symbol] = k.split("|");
            const lp = await shoonyaQuote(
              this.brokerSession!.token,
              this.brokerSession!.userId,
              exchange,
              symbol,
            );
            return [k, lp] as const;
          }),
        );
        for (const [k, lp] of results) if (lp !== null) quotes.set(k, lp);
      }

      // compute mtm & manage each deployment
      let totalPnl = 0;
      const managed: Array<{ d: DeployLike; unrealized: number }> = [];
      for (const d of running) {
        const unrealized = await this.mtmDeployment(d as unknown as DeployLike, quotes, d.mode === "LIVE" && marketOpen);
        totalPnl += d.realizedPnl + unrealized;
        managed.push({ d: d as unknown as DeployLike, unrealized });
      }

      // kill switch: day max loss across all deployments
      if (totalPnl <= -Math.abs(dayMaxLoss)) {
        for (const { d, unrealized } of managed) {
          if (d.status !== "RUNNING") continue;
          await this.closeDeployment(d, "KILL_SWITCH", "KILLED",
            `Day max-loss limit of ₹${Math.abs(dayMaxLoss).toLocaleString("en-IN")} hit — kill switch squared off everything.`);
        }
        await this.logEvent(null, "KILL_SWITCH",
          `DAY MAX LOSS breached: total P&L ₹${Math.round(totalPnl).toLocaleString("en-IN")} ≤ -₹${Math.abs(dayMaxLoss).toLocaleString("en-IN")}`, "WARN");
        return;
      }

      for (const { d, unrealized } of managed) {
        if (d.status === "PAUSED") continue;
        const openLegs = d.legs.filter((l) => l.status === "OPEN" || l.status === "PENDING");
        const entryMin = hhmmToMinutes(d.entryTime);
        const soMin = hhmmToMinutes(d.squareOffTime);
        const nowMin = now.hh * 60 + now.minute;

        // paper deployments can trade in a simulated session outside market hours;
        // live deployments stay strictly market-bound
        const canTrade = marketOpen || (d.mode === "PAPER" && paperSim);

        if (openLegs.length === 0) {
          if (canTrade && nowMin >= entryMin) {
            await this.enterDeployment(d.id, now);
          }
        } else {
          const totalPnlD = d.realizedPnl + unrealized;
          if (d.targetProfit && totalPnlD >= d.targetProfit) {
            await this.closeDeployment(d, "TARGET_HIT", "COMPLETED",
              `Target profit ₹${d.targetProfit.toLocaleString("en-IN")} reached (P&L ₹${Math.round(totalPnlD).toLocaleString("en-IN")}).`);
          } else if (marketOpen && nowMin >= soMin) {
            // timed exit only binds during real market hours (simulated sessions skip it)
            await this.closeDeployment(d, "SQUARE_OFF", "COMPLETED",
              `Timed exit at ${d.squareOffTime} IST — all legs squared off.`);
          }
        }
      }
    } finally {
      this.state.ticking = false;
    }
  }

  // ---------- MTM ----------
  private async mtmDeployment(
    d: DeployLike,
    quotes: Map<string, number>,
    live: boolean,
  ): Promise<number> {
    const inst = getInstrument(d.instrument);
    let unrealized = 0;
    const now = istNow();
    for (const leg of d.legs.filter((l) => l.status === "OPEN")) {
      let ltp = leg.ltp ?? leg.entryPrice ?? 0;
      if (live) {
        const q = quotes.get(`${leg.exchange}|${leg.symbol}`);
        if (q !== undefined) ltp = q;
      } else {
        const years = expiryYears(leg.expiryDate);
        const px = blackScholes({
          spot: this.spot(inst.id),
          strike: leg.strike,
          iv: inst.iv,
          yearsToExpiry: years,
          type: leg.optionType as "CE" | "PE",
        });
        ltp = roundTick(px);
      }
      const dir = leg.side === "SELL" ? -1 : 1;
      unrealized += dir * (ltp - (leg.entryPrice ?? ltp)) * leg.qty;

      // per-leg stop-loss
      if (leg.slPrice && leg.entryPrice) {
        const hit = leg.side === "SELL" ? ltp >= leg.slPrice : ltp <= leg.slPrice;
        if (hit) {
          await this.closeLeg(d, leg, ltp, "CLOSED_SL", "LEG_SL",
            `${leg.side === "SELL" ? "Sell" : "Buy"} ${leg.symbol} SL hit at ₹${ltp.toFixed(2)} (SL ₹${leg.slPrice.toFixed(2)}).`);
          unrealized = 0; // recompute next tick; avoid double counting this tick
          continue;
        }
      }
      if (leg.ltp !== ltp) {
        await db.leg.update({ where: { id: leg.id }, data: { ltp } });
      }
    }
    void now;
    return unrealized;
  }
  // ---------- entry ----------
  private async enterDeployment(deploymentId: string, now: ReturnType<typeof istNow>) {
    const d = await db.deployment.findUnique({ where: { id: deploymentId }, include: { legs: true } });
    if (!d || d.legs.some((l) => l.status === "OPEN" || l.status === "PENDING")) return;
    const inst = getInstrument(d.instrument);
    const strat = getStrategy(d.strategyType);

    // resolve expiry (re-resolve when stale)
    let expiryNear: Date;
    let expiryFar: Date;
    const todayMid = new Date(); todayMid.setUTCHours(0, 0, 0, 0);
    if (d.expiryDate && new Date(`${d.expiryDate}T00:00:00Z`) >= todayMid) {
      const near = resolveExpiry(inst, "NEAREST", now.date);
      const far = resolveExpiry(inst, "NEXT", now.date);
      expiryNear = new Date(`${d.expiryDate}T00:00:00Z`);
      expiryFar = strat.calendar ? far.date : expiryNear;
      if (near.date.getTime() !== expiryNear.getTime()) {
        // stored expiry no longer the nearest — refresh unless NEXT mode selected it deliberately
        if (d.expiryMode === "NEAREST") {
          expiryNear = near.date;
          await db.deployment.update({ where: { id: d.id }, data: { expiryDate: expiryISO(near.date) } });
        }
      }
    } else {
      const near = resolveExpiry(inst, "NEAREST", now.date);
      const far = resolveExpiry(inst, "NEXT", now.date);
      expiryNear = near.date;
      expiryFar = strat.calendar ? far.date : near.date;
      await db.deployment.update({
        where: { id: d.id },
        data: { expiryDate: expiryISO(strat.calendar ? near.date : near.date) },
      });
    }

    // spot: live -> broker quote of index; paper -> simulated walk
    let spot = this.spot(inst.id);
    if (d.mode === "LIVE") {
      if (await this.ensureBroker()) {
        const lp = await shoonyaQuote(this.brokerSession!.token, this.brokerSession!.userId, inst.exchange, inst.id);
        if (lp && lp > 0) spot = lp;
        else await this.logThrottledError(d.id, `No index quote for ${inst.id}; using fallback ₹${spot}.`);
      } else {
        await this.logEvent(d.id, "ERROR", "Live entry skipped — broker session unavailable.", "ERROR");
        return;
      }
    }

    // direction for AUTO strategies (ORB / momentum): spot vs day-open
    let direction = d.direction as "AUTO" | "BULLISH" | "BEARISH";
    if (direction === "AUTO" && (strat.id === "ORB_DIRECTIONAL" || strat.id === "MOMENTUM_BUY")) {
      direction = spot >= this.dayOpen(inst.id) ? "BULLISH" : "BEARISH";
    }

    const legs = buildLegs(strat.id, {
      inst,
      spot,
      otmGap: d.otmGap,
      wingGap: d.wingGap,
      direction: direction as "AUTO" | "BULLISH" | "BEARISH",
      expiryNear,
      expiryFar: expiryFar,
    });
    if (legs.length === 0) return;

    const qty = d.lots * inst.lotSize;
    const live = d.mode === "LIVE";
    const created: Array<{ symbol: string; side: string; entry: number; sl: number | null }> = [];
    let allOk = true;

    for (const spec of legs) {
      let entryPrice: number;
      let orderStatus = "FILLED";
      let brokerOrderId: string | null = null;
      let orderMsg = "";

      if (live) {
        // resolve tradingsymbol with holiday-shift fallback (expiry may move ±days on the exchange)
        let resolvedSymbol = spec.symbol;
        let resolvedExpiry = spec.expiry;
        let q = await shoonyaQuote(this.brokerSession!.token, this.brokerSession!.userId, spec.exchange, resolvedSymbol);
        if (q === null) {
          for (const off of [-1, 1, -2, 2]) {
            const d2 = new Date(spec.expiry.getTime() + off * 86400000);
            const s2 = optionSymbol(inst, d2, spec.strike, spec.optionType);
            const q2 = await shoonyaQuote(this.brokerSession!.token, this.brokerSession!.userId, spec.exchange, s2);
            if (q2 !== null) {
              resolvedSymbol = s2;
              resolvedExpiry = d2;
              q = q2;
              break;
            }
          }
        }
        if (q === null) {
          allOk = false;
          orderStatus = "REJECTED";
          orderMsg = "Quote unavailable";
          entryPrice = 0;
          spec.symbol = resolvedSymbol;
          spec.expiry = resolvedExpiry;
        } else {
          spec.symbol = resolvedSymbol;
          spec.expiry = resolvedExpiry;
          entryPrice = q;
          const res = await shoonyaPlaceOrder(
            this.brokerSession!.token,
            this.brokerSession!.actid,
            this.brokerSession!.userId,
            {
              exchange: spec.exchange,
              symbol: spec.symbol,
              qty,
              side: spec.side === "BUY" ? "B" : "S",
              price: 0,
              priceType: "MKT",
              product: "I",
              remarks: `SA:${d.id.slice(-6)}`,
            },
          );
          if (res.ok) {
            brokerOrderId = res.orderId ?? null;
            orderMsg = `Live order placed (${res.orderId})`;
          } else {
            allOk = false;
            orderStatus = "REJECTED";
            orderMsg = res.error ?? "Rejected";
          }
        }
      } else {
        const years = Math.max((spec.expiry.getTime() + 10 * 3600000 - Date.now()) / (86400000 * 365), 0.00004);
        const px = roundTick(blackScholes({ spot, strike: spec.strike, iv: inst.iv, yearsToExpiry: years, type: spec.optionType }));
        entryPrice = roundTick(px * (1 + (spec.side === "BUY" ? SLIPPAGE : -SLIPPAGE)));
        orderMsg = `Paper fill @ ₹${entryPrice.toFixed(2)} (BS ₹${px.toFixed(2)})`;
      }

      await db.order.create({
        data: {
          deploymentId: d.id,
          tsym: spec.symbol,
          exchange: spec.exchange,
          side: spec.side === "BUY" ? "B" : "S",
          qty,
          price: entryPrice,
          priceType: live ? "MKT" : "MKT",
          mode: d.mode,
          status: orderStatus,
          brokerOrderId,
          message: orderMsg,
        },
      });

      if (orderStatus === "REJECTED") {
        await db.leg.create({
          data: {
            deploymentId: d.id,
            symbol: spec.symbol,
            exchange: spec.exchange,
            strike: spec.strike,
            optionType: spec.optionType,
            side: spec.side,
            lotSize: inst.lotSize,
            qty,
            expiryDate: expiryISO(spec.expiry),
            status: "REJECTED",
          },
        });
        continue;
      }

      const slPrice = spec.side === "SELL"
        ? roundTick(entryPrice * (1 + d.legSlPct / 100))
        : roundTick(entryPrice * (1 - d.legSlPct / 100));

      await db.leg.create({
        data: {
          deploymentId: d.id,
          symbol: spec.symbol,
          exchange: spec.exchange,
          strike: spec.strike,
          optionType: spec.optionType,
          side: spec.side,
          lotSize: inst.lotSize,
          qty,
          expiryDate: expiryISO(spec.expiry),
          entryPrice,
          ltp: entryPrice,
          slPrice,
          status: "OPEN",
          openedAt: new Date(),
        },
      });
      created.push({ symbol: spec.symbol, side: spec.side, entry: entryPrice, sl: slPrice });
    }

    if (created.length === 0) {
      await this.logEvent(d.id, "ERROR", `Entry failed — all leg orders rejected. Deployment paused.`, "ERROR");
      await db.deployment.update({ where: { id: d.id }, data: { status: "ERROR", statusNote: "Entry orders rejected" } });
      return;
    }

    const legsTxt = created.map((c) => `${c.side} ${c.symbol} @ ₹${c.entry.toFixed(2)}`).join(" | ");
    await this.logEvent(d.id, "ENTRY_FILLED",
      `${live ? "LIVE" : "PAPER"} entry: ${d.lots} lot(s) × ${inst.lotSize} — ${legsTxt}`, "TRADE");
    if (!allOk) {
      await this.logEvent(d.id, "WARN", "One or more legs rejected during entry — remaining legs are running.", "WARN");
    }
  }

  // ---------- exits ----------
  private async closeLeg(
    d: { id: string; mode: string; realizedPnl: number },
    leg: { id: string; symbol: string; exchange: string; side: string; qty: number; entryPrice: number | null; ltp: number | null },
    exitPrice: number,
    legStatus: string,
    eventType: string,
    message: string,
  ) {
    const live = d.mode === "LIVE";
    // closing a SELL = BUY (slip up), closing a BUY = SELL (slip down)
    const px = live
      ? exitPrice
      : roundTick(exitPrice * (1 + (leg.side === "SELL" ? SLIPPAGE : -SLIPPAGE)));
    const dir = leg.side === "SELL" ? -1 : 1;
    const pnl = Math.round(dir * (px - (leg.entryPrice ?? px)) * leg.qty * 100) / 100;

    await db.leg.update({
      where: { id: leg.id },
      data: { status: legStatus, exitPrice: px, ltp: px, closedAt: new Date(), realizedPnl: pnl },
    });
    await db.order.create({
      data: {
        deploymentId: d.id,
        tsym: leg.symbol,
        exchange: leg.exchange,
        side: leg.side === "SELL" ? "B" : "S",
        qty: leg.qty,
        price: px,
        priceType: "MKT",
        mode: d.mode,
        status: "FILLED",
        message: live ? "Live square-off order" : `Paper exit @ ₹${px.toFixed(2)}`,
      },
    });
    await db.deployment.update({
      where: { id: d.id },
      data: { realizedPnl: { increment: pnl } },
    });
    await this.logEvent(d.id, eventType, `${message} P&L ₹${pnl.toLocaleString("en-IN")}.`, "TRADE");
  }

  private async closeDeployment(
    d: DeployLike,
    eventType: string,
    newStatus: string,
    message: string,
  ) {
    const fresh = await db.deployment.findUnique({ where: { id: d.id }, include: { legs: true } });
    if (!fresh) return;
    const openLegs = fresh.legs.filter((l) => l.status === "OPEN");
    for (const leg of openLegs) {
      const ltp = leg.ltp ?? leg.entryPrice ?? 0;
      await this.closeLeg(fresh, leg, ltp, legStatusFromEvent(eventType), eventType, `${leg.symbol} squared off.`);
    }
    await db.deployment.update({
      where: { id: d.id },
      data: { status: newStatus, stoppedAt: new Date(), statusNote: message },
    });
    await this.logEvent(
      d.id,
      eventType,
      `${message} Deployment ${newStatus}. Realized P&L ₹${Math.round(fresh.realizedPnl).toLocaleString("en-IN")}.`,
      eventType === "KILL_SWITCH" ? "WARN" : "INFO",
    );
  }
}

function legStatusFromEvent(e: string): string {
  switch (e) {
    case "TARGET_HIT": return "CLOSED_TARGET";
    case "KILL_SWITCH": return "CLOSED_MANUAL";
    case "SQUARE_OFF": return "CLOSED_TIME";
    default: return "CLOSED_MANUAL";
  }
}

function expiryYears(expiryISODate: string | null): number {
  if (!expiryISODate) return 0.0001;
  const [y, m, dd] = expiryISODate.split("-").map((x) => parseInt(x, 10));
  const settle = Date.UTC(y, m - 1, dd, 10, 0, 0); // 15:30 IST
  return Math.max((settle - Date.now()) / (86400000 * 365), 0.00004); // YEARS
}

function expiryISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getEngine(): Engine {
  const existing = g.__shoonyaAlgoEngine;
  if (existing && existing.codeVersion === ENGINE_VERSION) return existing;
  if (existing) {
    try {
      existing.stop();
    } catch {
      /* ignore */
    }
  }
  const fresh = new Engine();
  if (existing) {
    try {
      // carry over live broker session and simulated spots from the previous instance
      fresh.brokerSession = existing.brokerSession;
    } catch {
      /* ignore */
    }
  }
  g.__shoonyaAlgoEngine = fresh;
  fresh.start();
  // the stock scanner rides on the same lifecycle
  getScanner().start();
  return fresh;
}

export type { Engine };
