// Stock scanner engine.
// A singleton 5s loop that:
//  - walks simulated prices for the NSE F&O universe (paper mode)
//  - pulls real NSE quotes via Shoonya when a LIVE scanner is enabled
//  - evaluates ORB (opening-range breakout) and Momentum signals per enabled stock
//  - optionally auto-places scan trades (paper fill or live order), then manages
//    MTM, per-trade SL / target and timed square-off

import { db } from "@/lib/db";
import { STOCK_UNIVERSE, STOCK_MAP, getStock } from "./stocks";
import { gaussian, roundTick } from "./pricing";
import { istNow, isMarketOpen, hhmmToMinutes } from "./market";
import { shoonyaLogin, shoonyaQuote, ShoonyaCreds } from "./shoonya";

const SCAN_TICK_MS = 5000;
const SLIPPAGE = 0.0005; // 0.05% adverse paper fill on stock entries
const ORB_TICKS = 15; // ticks forming the opening range (~75s in sim)
const MOMENTUM_WARMUP_TICKS = 10;
const MOMENTUM_THRESHOLD = 0.005; // 0.5% move from day open
const ERROR_THROTTLE_MS = 5 * 60 * 1000;

interface ScannerState {
  prices: Map<string, number>;
  dayOpen: Map<string, number>;
  orbHigh: Map<string, number>;
  orbLow: Map<string, number>;
  orbTicks: Map<string, number>;
  day: string;
  cooldown: Set<string>; // `${symbol}` signaled today
  lastErrorAt: number;
  ticking: boolean;
  session: { token: string; actid: string; userId: string } | null;
}

const g = globalThis as unknown as { __shoonyaAlgoScanner?: Scanner };

const SCANNER_VERSION = 1;

export interface ScannerUniverseRow {
  symbol: string;
  name: string;
  price: number;
  dayOpen: number;
  chgPct: number;
  orbHigh: number | null;
  orbLow: number | null;
  rangeReady: boolean;
  enabled: boolean;
  state: "SCANNING" | "IN_TRADE" | "COOLDOWN" | "IDLE";
}

class Scanner {
  readonly codeVersion = SCANNER_VERSION;
  private state: ScannerState = {
    prices: new Map(),
    dayOpen: new Map(),
    orbHigh: new Map(),
    orbLow: new Map(),
    orbTicks: new Map(),
    day: "",
    cooldown: new Set(),
    lastErrorAt: 0,
    ticking: false,
    session: null,
  };
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.timer) return;
    for (const s of STOCK_UNIVERSE) this.state.prices.set(s.symbol, s.basePrice);
    console.log(`[scanner] started v${this.codeVersion} (${STOCK_UNIVERSE.length} symbols)`);
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
    return this.state.prices.get(symbol) ?? STOCK_MAP[symbol]?.basePrice ?? 0;
  }

  private rollDay(day: string) {
    if (this.state.day !== day) {
      this.state.day = day;
      this.state.dayOpen.clear();
      this.state.orbHigh.clear();
      this.state.orbLow.clear();
      this.state.orbTicks.clear();
      this.state.cooldown.clear();
    }
  }

  private walk() {
    for (const s of STOCK_UNIVERSE) {
      const p = this.state.prices.get(s.symbol) ?? s.basePrice;
      // ~0.08% of price per 5s tick scaled by each stock's vol -> signals in minutes
      const next = p + (s.basePrice - p) * 0.0004 + p * s.vol * 0.0035 * gaussian();
      const snapped = Math.round(next * 100) / 100;
      this.state.prices.set(s.symbol, snapped);
      if (!this.state.dayOpen.has(s.symbol)) this.state.dayOpen.set(s.symbol, snapped);
    }
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
        .map((s) => s.trim())
        .filter((s) => STOCK_MAP[s] !== undefined);

      const live = config.mode === "LIVE";

      // ---------- price source ----------
      if (live && enabledSymbols.length > 0) {
        const ok = await this.ensureSession();
        if (!ok) {
          this.throttleError("Scanner LIVE mode: no broker session — quotes unavailable. Configure Shoonya credentials in Settings.");
          return;
        }
        const results = await Promise.all(
          enabledSymbols.map(async (sym) => {
            const lp = await shoonyaQuote(this.state.session!.token, this.state.session!.userId, "NSE", `${sym}-EQ`);
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
          this.throttleError("Scanner LIVE mode: NSE quotes unreachable from this machine. Check network / broker session.");
          return;
        }
      } else {
        // paper (and pre-warm of sim sessions): walk simulated prices
        this.walk();
      }

      if (!config.enabled || enabledSymbols.length === 0) return;

      // ---------- manage open scan trades ----------
      await this.manageOpenTrades(config, now, marketOpen);

      // ---------- evaluate signals ----------
      const openTrades = await db.scanTrade.findMany({ where: { status: "OPEN" } });
      const inTrade = new Set(openTrades.map((t) => t.symbol));

      for (const sym of enabledSymbols) {
        const stock = getStock(sym);
        if (!stock) continue;
        const price = this.price(sym);
        const open = this.state.dayOpen.get(sym);
        if (!open) continue;

        // opening-range bookkeeping
        const t = (this.state.orbTicks.get(sym) ?? 0) + 1;
        this.state.orbTicks.set(sym, t);
        if (t <= ORB_TICKS) {
          this.state.orbHigh.set(sym, Math.max(this.state.orbHigh.get(sym) ?? price, price));
          this.state.orbLow.set(sym, Math.min(this.state.orbLow.get(sym) ?? price, price));
        }

        if (this.state.cooldown.has(sym) || inTrade.has(sym)) continue;

        let side: "LONG" | "SHORT" | null = null;
        let ref = 0;
        let note = "";

        if (config.strategy === "ORB") {
          if (t > ORB_TICKS) {
            const hi = this.state.orbHigh.get(sym);
            const lo = this.state.orbLow.get(sym);
            if (hi && lo) {
              const buf = price * 0.0005;
              if (price > hi + buf) {
                side = "LONG";
                ref = hi;
                note = `Broke above opening range high ₹${hi.toFixed(2)} (range ₹${lo.toFixed(2)}–₹${hi.toFixed(2)}).`;
              } else if (price < lo - buf) {
                side = "SHORT";
                ref = lo;
                note = `Broke below opening range low ₹${lo.toFixed(2)} (range ₹${lo.toFixed(2)}–₹${hi.toFixed(2)}).`;
              }
            }
          }
        } else {
          // MOMENTUM
          if (t > MOMENTUM_WARMUP_TICKS) {
            const chg = price / open - 1;
            if (chg >= MOMENTUM_THRESHOLD) {
              side = "LONG";
              ref = open;
              note = `Up ${((price / open - 1) * 100).toFixed(2)}% from day open — momentum continuation.`;
            } else if (chg <= -MOMENTUM_THRESHOLD) {
              side = "SHORT";
              ref = open;
              note = `Down ${(Math.abs(chg) * 100).toFixed(2)}% from day open — momentum breakdown.`;
            }
          }
        }

        if (!side) continue;

        // record signal
        this.state.cooldown.add(sym);
        let placed = false;
        let tradeId: string | null = null;

        if (config.autoPlace) {
          const qty = Math.max(1, Math.floor(config.capitalPerTrade / price));
          const entry = roundTick(price * (1 + (side === "LONG" ? SLIPPAGE : -SLIPPAGE)));
          const slPrice =
            side === "LONG"
              ? roundTick(entry * (1 - config.slPct / 100))
              : roundTick(entry * (1 + config.slPct / 100));
          const targetPrice =
            side === "LONG"
              ? roundTick(entry * (1 + config.targetPct / 100))
              : roundTick(entry * (1 - config.targetPct / 100));

          const trade = await db.scanTrade.create({
            data: {
              symbol: sym,
              side,
              qty,
              entryPrice: entry,
              ltp: entry,
              slPrice,
              targetPrice,
              mode: config.mode,
              status: "OPEN",
            },
          });
          tradeId = trade.id;
          placed = true;

          await db.order.create({
            data: {
              deploymentId: null,
              tsym: `${sym}-EQ`,
              exchange: "NSE",
              side: side === "LONG" ? "B" : "S",
              qty,
              price: entry,
              priceType: "MKT",
              mode: config.mode,
              status: "FILLED",
              message: config.mode === "LIVE" ? "Live scanner order placed" : `Scanner paper fill @ ₹${entry.toFixed(2)}`,
            },
          });
          await db.event.create({
            data: {
              deploymentId: null,
              type: "SCAN_ENTRY",
              level: "TRADE",
              message: `Scanner ${config.mode} ${side} ${sym} × ${qty} @ ₹${entry.toFixed(2)} — SL ₹${slPrice.toFixed(2)}, target ₹${targetPrice.toFixed(2)}.`,
            },
          }).catch(() => {});

          if (config.mode === "LIVE" && this.state.session) {
            // fire the real order (best effort; fills tracked via broker)
            const { shoonyaPlaceOrder } = await import("./shoonya");
            await shoonyaPlaceOrder(
              this.state.session.token,
              this.state.session.actid,
              this.state.session.userId,
              {
                exchange: "NSE",
                symbol: `${sym}-EQ`,
                qty,
                side: side === "LONG" ? "B" : "S",
                price: 0,
                priceType: "MKT",
                product: "I",
                remarks: "SA-SCAN",
              },
            ).catch(() => null);
          }
        }

        await db.scanSignal.create({
          data: {
            symbol: sym,
            strategy: config.strategy,
            side,
            refPrice: ref,
            price,
            note,
            placed,
            tradeId,
          },
        });
      }
    } finally {
      this.state.ticking = false;
    }
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
      const ltp = this.price(trade.symbol);
      if (!ltp) continue;
      const dir = trade.side === "LONG" ? 1 : -1;

      let closeStatus: string | null = null;
      let closeMsg = "";
      if (trade.slPrice && ((trade.side === "LONG" && ltp <= trade.slPrice) || (trade.side === "SHORT" && ltp >= trade.slPrice))) {
        closeStatus = "CLOSED_SL";
        closeMsg = `Stop-loss ₹${trade.slPrice.toFixed(2)} hit`;
      } else if (trade.targetPrice && ((trade.side === "LONG" && ltp >= trade.targetPrice) || (trade.side === "SHORT" && ltp <= trade.targetPrice))) {
        closeStatus = "CLOSED_TARGET";
        closeMsg = `Target ₹${trade.targetPrice.toFixed(2)} reached`;
      } else if (marketOpen && nowMin >= soMin) {
        closeStatus = "CLOSED_TIME";
        closeMsg = `Timed square-off at ${config.squareOffTime} IST`;
      }

      if (closeStatus) {
        const exit = roundTick(ltp * (1 + (trade.side === "LONG" ? -SLIPPAGE : SLIPPAGE)));
        const pnl = Math.round(dir * (exit - trade.entryPrice) * trade.qty * 100) / 100;
        await db.scanTrade.update({
          where: { id: trade.id },
          data: { status: closeStatus, exitPrice: exit, ltp: exit, realizedPnl: pnl, closedAt: new Date() },
        });
        await db.order.create({
          data: {
            deploymentId: null,
            tsym: `${trade.symbol}-EQ`,
            exchange: "NSE",
            side: trade.side === "LONG" ? "S" : "B",
            qty: trade.qty,
            price: exit,
            priceType: "MKT",
            mode: trade.mode,
            status: "FILLED",
            message: `Scanner exit (${closeStatus}) @ ₹${exit.toFixed(2)}`,
          },
        });
        await db.event.create({
          data: {
            deploymentId: null,
            type: "SCAN_EXIT",
            level: "TRADE",
            message: `Scanner ${trade.side} ${trade.symbol} closed — ${closeMsg}. P&L ₹${pnl.toLocaleString("en-IN")}.`,
          },
        }).catch(() => {});
      } else if (trade.ltp !== ltp) {
        await db.scanTrade.update({ where: { id: trade.id }, data: { ltp } });
      }
    }
    void config;
  }

  // ---------- manual ops ----------
  async closeTrade(tradeId: string, reason = "CLOSED_MANUAL") {
    const trade = await db.scanTrade.findUnique({ where: { id: tradeId } });
    if (!trade || trade.status !== "OPEN") return;
    const ltp = this.price(trade.symbol) || trade.ltp || trade.entryPrice;
    const exit = roundTick(ltp * (1 + (trade.side === "LONG" ? -SLIPPAGE : SLIPPAGE)));
    const dir = trade.side === "LONG" ? 1 : -1;
    const pnl = Math.round(dir * (exit - trade.entryPrice) * trade.qty * 100) / 100;
    await db.scanTrade.update({
      where: { id: trade.id },
      data: { status: reason, exitPrice: exit, ltp: exit, realizedPnl: pnl, closedAt: new Date() },
    });
    await db.order.create({
      data: {
        deploymentId: null,
        tsym: `${trade.symbol}-EQ`,
        exchange: "NSE",
        side: trade.side === "LONG" ? "S" : "B",
        qty: trade.qty,
        price: exit,
        priceType: "MKT",
        mode: trade.mode,
        status: "FILLED",
        message: `Scanner manual exit @ ₹${exit.toFixed(2)}`,
      },
    });
    await db.event.create({
      data: {
        deploymentId: null,
        type: "SCAN_EXIT",
        level: "TRADE",
        message: `Scanner ${trade.side} ${trade.symbol} closed manually @ ₹${exit.toFixed(2)}. P&L ₹${pnl.toLocaleString("en-IN")}.`,
      },
    }).catch(() => {});
  }

  /** Re-arm the simulated day: forget opens, ranges and signal cooldowns. */
  resetDay() {
    this.state.dayOpen.clear();
    this.state.orbHigh.clear();
    this.state.orbLow.clear();
    this.state.orbTicks.clear();
    this.state.cooldown.clear();
  }

  universe(enabledSet: Set<string>, inTradeSet: Set<string>): ScannerUniverseRow[] {
    const rows: ScannerUniverseRow[] = [];
    for (const s of STOCK_UNIVERSE) {
      const price = this.price(s.symbol);
      const open = this.state.dayOpen.get(s.symbol) ?? price;
      const hi = this.state.orbHigh.get(s.symbol) ?? null;
      const lo = this.state.orbLow.get(s.symbol) ?? null;
      const ticks = this.state.orbTicks.get(s.symbol) ?? 0;
      let state: ScannerUniverseRow["state"] = "IDLE";
      if (inTradeSet.has(s.symbol)) state = "IN_TRADE";
      else if (this.state.cooldown.has(s.symbol)) state = "COOLDOWN";
      else if (enabledSet.has(s.symbol)) state = "SCANNING";
      rows.push({
        symbol: s.symbol,
        name: s.name,
        price: Math.round(price * 100) / 100,
        dayOpen: Math.round(open * 100) / 100,
        chgPct: open ? Math.round((price / open - 1) * 10000) / 100 : 0,
        orbHigh: hi,
        orbLow: lo,
        rangeReady: ticks > ORB_TICKS,
        enabled: enabledSet.has(s.symbol),
        state,
      });
    }
    return rows;
  }

  sessionInfo() {
    return this.state.session !== null;
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
