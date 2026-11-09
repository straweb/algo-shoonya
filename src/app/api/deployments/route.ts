import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { legsUnrealized } from "@/lib/pnl";
import { getStrategy } from "@/lib/strategies";
import { resolveExpiry, getInstrument } from "@/lib/instruments";
import { isValidHhmm } from "@/lib/market";
import { estimateSizing } from "@/lib/sizing";

export const dynamic = "force-dynamic";

export async function GET() {
  getEngine();
  const deployments = await db.deployment.findMany({ include: { legs: true }, orderBy: { createdAt: "desc" } });
  const out = deployments.map((d) => {
    const unrealized = legsUnrealized(d.legs);
    return { ...d, realizedPnl: d.realizedPnl, unrealized, totalPnl: Math.round((d.realizedPnl + unrealized) * 100) / 100, legs: d.legs };
  });
  return NextResponse.json({ deployments: out });
}

export async function POST(req: NextRequest) {
  getEngine();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const {
    name, strategyType, instrument, expiryMode, direction, mode,
    capital, utilizationPct, otmGap, wingGap, entryTime, squareOffTime,
    legSlPct, targetProfit, startNow,
  } = body as Record<string, unknown>;

  // ---- validation ----
  let strat;
  try {
    strat = getStrategy(String(strategyType));
  } catch {
    return NextResponse.json({ error: "Unknown strategy type" }, { status: 400 });
  }
  let inst;
  try {
    inst = getInstrument(String(instrument));
  } catch {
    return NextResponse.json({ error: "Unknown instrument" }, { status: 400 });
  }
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap < 50000) {
    return NextResponse.json({ error: "Capital allocation must be at least ₹50,000" }, { status: 400 });
  }
  const util = Math.min(100, Math.max(10, Number(utilizationPct) || 100));
  const expiry = expiryMode === "NEXT" ? "NEXT" : "NEAREST";
  const entryT = isValidHhmm(String(entryTime ?? "")) ? String(entryTime) : strat.entryTime;
  const soT = isValidHhmm(String(squareOffTime ?? "")) ? String(squareOffTime) : strat.squareOffTime;
  if (hhmm(entryT) >= hhmm(soT)) {
    return NextResponse.json({ error: "Entry time must be before square-off time" }, { status: 400 });
  }
  const slPct = Math.min(100, Math.max(5, Number(legSlPct) || 50));
  const target = Number(targetProfit);
  const modeFinal = mode === "LIVE" ? "LIVE" : "PAPER";

  if (modeFinal === "LIVE") {
    const broker = await db.brokerAccount.findUnique({ where: { id: "shoonya" } });
    if (!broker?.userId) {
      return NextResponse.json({ error: "Connect your Shoonya account in Settings before creating a LIVE deployment." }, { status: 400 });
    }
  }

  // ---- sizing: % of capital -> lots ----
  const engine = getEngine();
  const sizing = estimateSizing({
    strategyId: strat.id,
    instrumentId: inst.id,
    capital: cap,
    utilizationPct: util,
    otmGap: Number(otmGap) || 0,
    wingGap: Number(wingGap) || 0,
    spot: engine.spot(inst.id),
  });

  const resolved = resolveExpiry(inst, expiry);
  const dir = strat.direction !== "AUTO" ? strat.direction : ["BULLISH", "BEARISH"].includes(String(direction)) ? String(direction) : "AUTO";

  const d = await db.deployment.create({
    data: {
      name: String(name || `${inst.id} ${strat.name}`),
      strategyType: strat.id,
      instrument: inst.id,
      expiryMode: expiry,
      expiryDate: resolved.date.toISOString().slice(0, 10),
      direction: dir,
      mode: modeFinal,
      capital: cap,
      utilizationPct: util,
      lots: sizing.lots,
      otmGap: Math.max(0, Number(otmGap) || 0),
      wingGap: Math.max(0, Number(wingGap) || 0),
      entryTime: entryT,
      squareOffTime: soT,
      legSlPct: slPct,
      targetProfit: Number.isFinite(target) && target > 0 ? target : null,
      status: startNow === false ? "STOPPED" : "RUNNING",
      startedAt: startNow === false ? null : new Date(),
    },
  });

  await db.event.create({
    data: {
      deploymentId: d.id,
      type: "STARTED",
      level: "INFO",
      message: `Deployment created — ${inst.id} ${strat.name}, ${expiry} expiry (${resolved.label}), ${sizing.lots} lot(s), ${modeFinal}, entry ${entryT} IST, SL ${slPct}%/leg.`,
    },
  });

  return NextResponse.json({ deployment: d, sizing }, { status: 201 });
}

function hhmm(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}
