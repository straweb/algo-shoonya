import { NextRequest, NextResponse } from "next/server";
import { runBacktest, BacktestConfig } from "@/lib/backtest";
import { STRATEGY_LIST, StrategyId } from "@/lib/strategies";
import { getInstrument, InstrumentId } from "@/lib/instruments";
import { isValidHhmm } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<BacktestConfig>;
    const strategyId = body.strategyId as StrategyId;
    const instrumentId = body.instrumentId as InstrumentId;

    if (!STRATEGY_LIST.some((s) => s.id === strategyId)) {
      return NextResponse.json({ error: "Unknown strategy." }, { status: 400 });
    }
    try {
      getInstrument(instrumentId);
    } catch {
      return NextResponse.json({ error: "Unknown instrument." }, { status: 400 });
    }

    const capital = Number(body.capital);
    if (!Number.isFinite(capital) || capital < 50000) {
      return NextResponse.json({ error: "Capital must be at least ₹50,000." }, { status: 400 });
    }

    const days = Math.max(5, Math.min(Number(body.days) || 30, 250));
    const entryTime = typeof body.entryTime === "string" && isValidHhmm(body.entryTime) ? body.entryTime : "09:20";
    const squareOffTime = typeof body.squareOffTime === "string" && isValidHhmm(body.squareOffTime) ? body.squareOffTime : "15:15";
    if (entryTime >= squareOffTime) {
      return NextResponse.json({ error: "Entry time must be before square-off time." }, { status: 400 });
    }

    const cfg: BacktestConfig = {
      strategyId,
      instrumentId,
      expiryMode: body.expiryMode === "NEXT" ? "NEXT" : "NEAREST",
      days,
      capital,
      utilizationPct: Math.max(10, Math.min(Number(body.utilizationPct) || 100, 100)),
      legSlPct: Math.max(10, Math.min(Number(body.legSlPct) || 50, 200)),
      targetProfit: body.targetProfit && Number(body.targetProfit) > 0 ? Number(body.targetProfit) : null,
      entryTime,
      squareOffTime,
      otmGap: Math.max(0, Number(body.otmGap) || 0),
      wingGap: Math.max(0, Number(body.wingGap) || 0),
      seed: Number(body.seed) || 0,
    };

    const result = runBacktest(cfg);
    return NextResponse.json({ result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Backtest failed." }, { status: 500 });
  }
}
