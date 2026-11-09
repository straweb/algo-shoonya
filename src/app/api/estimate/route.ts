import { NextRequest, NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";
import { estimateSizing } from "@/lib/sizing";
import { getStrategy } from "@/lib/strategies";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const engine = getEngine();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { strategyId, instrumentId, capital, utilizationPct, otmGap, wingGap } = body as Record<string, unknown>;
  let strat;
  try {
    strat = getStrategy(String(strategyId));
  } catch {
    return NextResponse.json({ error: "Unknown strategy" }, { status: 400 });
  }

  const cap = Number(capital) || 0;
  const util = Math.min(100, Math.max(1, Number(utilizationPct) || 100));

  const sizing = estimateSizing({
    strategyId: strat.id,
    instrumentId: String(instrumentId ?? "NIFTY"),
    capital: cap,
    utilizationPct: util,
    otmGap: Number(otmGap) || 0,
    wingGap: Number(wingGap) || 0,
    spot: engine.spot(String(instrumentId ?? "NIFTY") as never),
  });

  return NextResponse.json({ sizing });
}
