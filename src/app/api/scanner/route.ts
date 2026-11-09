import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getScanner } from "@/lib/scanner";
import { DEFAULT_SCANNER_SYMBOLS, parseScanSymbols, SCAN_ASSET_MAP, SCAN_ASSETS } from "@/lib/stocks";
import { isValidHhmm } from "@/lib/market";
import { PATTERN_MAP, validStrategyIds } from "@/lib/patterns";

export const dynamic = "force-dynamic";

const INDEX_SYMBOLS = SCAN_ASSETS.filter((a) => a.kind === "INDEX").map((a) => a.symbol);

async function ensureConfig() {
  const existing = await db.scannerConfig.findUnique({ where: { id: "global" } });
  if (existing) return existing;
  return db.scannerConfig.create({
    data: {
      id: "global",
      symbols: [...INDEX_SYMBOLS.slice(0, 2), ...DEFAULT_SCANNER_SYMBOLS].join(","),
      strategies: "ORB,MOMENTUM,LIQUIDITY_SWEEP,ORDER_BLOCK,HEAD_SHOULDERS,DOUBLE_BOTTOM,DOUBLE_TOP",
    },
  });
}

async function snapshot() {
  const config = await ensureConfig();
  const scanner = getScanner();
  const enabled = new Set(parseScanSymbols(config.symbols));
  const openTrades = await db.scanTrade.findMany({ where: { status: "OPEN" }, orderBy: { openedAt: "desc" } });
  const closedTrades = await db.scanTrade.findMany({
    where: { status: { not: "OPEN" } },
    orderBy: { closedAt: "desc" },
    take: 25,
  });
  const signals = await db.scanSignal.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const inTrade = new Set(openTrades.map((t) => t.symbol));

  let strategies: string[] = [];
  try {
    const parsed = JSON.parse(config.strategies) as unknown;
    if (Array.isArray(parsed)) strategies = parsed.map(String).filter((s) => validStrategyIds().includes(s));
  } catch {
    strategies = ["ORB"];
  }
  let patternParams: Record<string, Record<string, number>> = {};
  try {
    patternParams = JSON.parse(config.patternParams) as typeof patternParams;
  } catch {
    patternParams = {};
  }

  // unrealized P&L: cash trades on spot diff, index trades on premium diff
  const unrealized = openTrades.reduce((a, t) => {
    if (t.kind === "INDEX") {
      if (t.entryPremium == null) return a;
      return a + ((t.ltpPremium ?? t.entryPremium) - t.entryPremium) * t.execQty;
    }
    return a + (t.side === "LONG" ? 1 : -1) * ((t.ltp ?? t.entryPrice) - t.entryPrice) * t.qty;
  }, 0);
  const realizedToday = closedTrades.reduce((a, t) => a + t.realizedPnl, 0);

  return {
    config: {
      enabled: config.enabled,
      strategy: config.strategy, // legacy
      strategies,
      patternParams,
      candleSeconds: config.candleSeconds,
      autoPlace: config.autoPlace,
      mode: config.mode,
      capitalPerTrade: config.capitalPerTrade,
      slPct: config.slPct,
      targetPct: config.targetPct,
      squareOffTime: config.squareOffTime,
      symbols: Array.from(enabled),
    },
    universe: scanner.universe(enabled, inTrade),
    openTrades,
    closedTrades,
    signals,
    stats: {
      openTrades: openTrades.length,
      realizedToday: Math.round(realizedToday * 100) / 100,
      unrealized: Math.round(unrealized * 100) / 100,
      total: Math.round((realizedToday + unrealized) * 100) / 100,
      signalsToday: signals.filter(
        (s) => new Date(s.createdAt).toDateString() === new Date().toDateString(),
      ).length,
    },
  };
}

export async function GET() {
  try {
    return NextResponse.json(await snapshot());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action: string;
      symbol?: string;
      on?: boolean;
      id?: string;
      config?: Record<string, unknown>;
    };
    const scanner = getScanner();
    await ensureConfig();

    switch (body.action) {
      case "setConfig": {
        const c = body.config ?? {};
        const data: Record<string, unknown> = {};
        if (typeof c.enabled === "boolean") data.enabled = c.enabled;
        if (Array.isArray(c.strategies)) {
          const valid = validStrategyIds();
          const list = c.strategies.map(String).filter((s) => valid.includes(s));
          data.strategies = JSON.stringify(list);
        }
        if (c.patternParams && typeof c.patternParams === "object") {
          // sanitize: only known pattern ids, only known numeric params in range
          const clean: Record<string, Record<string, number>> = {};
          const src = c.patternParams as Record<string, Record<string, unknown>>;
          for (const [pid, params] of Object.entries(src)) {
            const def = PATTERN_MAP[pid];
            if (!def || typeof params !== "object" || params === null) continue;
            const row: Record<string, number> = {};
            for (const p of def.params) {
              const v = Number(params[p.key]);
              if (Number.isFinite(v) && v >= p.min && v <= p.max) row[p.key] = v;
            }
            clean[pid] = row;
          }
          data.patternParams = JSON.stringify(clean);
        }
        if (Number.isFinite(Number(c.candleSeconds))) {
          const cs = Number(c.candleSeconds);
          if (cs >= 15 && cs <= 300) data.candleSeconds = Math.round(cs);
        }
        if (typeof c.autoPlace === "boolean") data.autoPlace = c.autoPlace;
        if (c.mode === "PAPER" || c.mode === "LIVE") data.mode = c.mode;
        if (Number.isFinite(Number(c.capitalPerTrade)) && Number(c.capitalPerTrade) >= 1000) {
          data.capitalPerTrade = Number(c.capitalPerTrade);
        }
        if (Number.isFinite(Number(c.slPct)) && Number(c.slPct) > 0 && Number(c.slPct) <= 10) {
          data.slPct = Number(c.slPct);
        }
        if (Number.isFinite(Number(c.targetPct)) && Number(c.targetPct) > 0 && Number(c.targetPct) <= 20) {
          data.targetPct = Number(c.targetPct);
        }
        if (typeof c.squareOffTime === "string" && isValidHhmm(c.squareOffTime)) {
          data.squareOffTime = c.squareOffTime;
        }
        await db.scannerConfig.update({ where: { id: "global" }, data });
        break;
      }
      case "toggleSymbol": {
        const sym = (body.symbol ?? "").toUpperCase();
        if (!SCAN_ASSET_MAP[sym]) return NextResponse.json({ error: "Unknown symbol." }, { status: 400 });
        const config = await db.scannerConfig.findUnique({ where: { id: "global" } });
        const set = new Set(parseScanSymbols(config?.symbols ?? ""));
        if (body.on) set.add(sym);
        else set.delete(sym);
        await db.scannerConfig.update({ where: { id: "global" }, data: { symbols: Array.from(set).join(",") } });
        break;
      }
      case "setAllSymbols": {
        const all = body.on ? SCAN_ASSETS.map((a) => a.symbol) : [];
        await db.scannerConfig.update({ where: { id: "global" }, data: { symbols: all.join(",") } });
        break;
      }
      case "closeTrade": {
        if (!body.id) return NextResponse.json({ error: "Missing trade id." }, { status: 400 });
        await scanner.closeTrade(body.id);
        break;
      }
      case "resetDay": {
        scanner.resetDay();
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    return NextResponse.json(await snapshot());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
