// Builds concrete option-leg plans for each strategy given a spot price.
// Shared by the live entry engine and the sizing estimator.

import { InstrumentDef, optionSymbol, roundStrike } from "./instruments";
import { StrategyId } from "./strategies";

export interface LegSpec {
  symbol: string;
  exchange: string;
  strike: number;
  optionType: "CE" | "PE";
  side: "BUY" | "SELL";
  expiry: Date;
}

export interface PlanContext {
  inst: InstrumentDef;
  spot: number;
  otmGap: number; // points (0 = auto)
  wingGap: number; // points (0 = auto)
  direction: "AUTO" | "BULLISH" | "BEARISH";
  expiryNear: Date;
  expiryFar: Date;
}

export function autoGap(spot: number, step: number): number {
  return Math.max(step, roundStrike(spot * 0.004, step));
}

export function autoWing(spot: number, step: number): number {
  return Math.max(step, roundStrike(spot * 0.006, step));
}

export function buildLegs(strategy: StrategyId, ctx: PlanContext): LegSpec[] {
  const { inst, spot } = ctx;
  const step = inst.strikeStep;
  const atm = roundStrike(spot, step);
  const gap = ctx.otmGap > 0 ? Math.max(step, ctx.otmGap) : autoGap(spot, step);
  const wing = ctx.wingGap > 0 ? Math.max(step, ctx.wingGap) : autoWing(spot, step);
  const sym = (strike: number, type: "CE" | "PE", expiry: Date) =>
    optionSymbol(inst, expiry, strike, type);

  const mk = (
    strike: number,
    type: "CE" | "PE",
    side: "BUY" | "SELL",
    expiry: Date = ctx.expiryNear,
  ): LegSpec => ({
    symbol: sym(strike, type, expiry),
    exchange: inst.exchange,
    strike,
    optionType: type,
    side,
    expiry,
  });

  switch (strategy) {
    case "SHORT_STRADDLE_920":
      return [mk(atm, "CE", "SELL"), mk(atm, "PE", "SELL")];
    case "SHORT_STRANGLE":
      return [mk(atm + gap, "CE", "SELL"), mk(atm - gap, "PE", "SELL")];
    case "IRON_CONDOR":
      return [
        mk(atm + gap, "CE", "SELL"),
        mk(atm + gap + wing, "CE", "BUY"),
        mk(atm - gap, "PE", "SELL"),
        mk(atm - gap - wing, "PE", "BUY"),
      ];
    case "BULL_CALL_SPREAD":
      return [mk(atm, "CE", "BUY"), mk(atm + gap, "CE", "SELL")];
    case "BEAR_PUT_SPREAD":
      return [mk(atm, "PE", "BUY"), mk(atm - gap, "PE", "SELL")];
    case "LONG_CALL":
      return [mk(atm, "CE", "BUY")];
    case "LONG_PUT":
      return [mk(atm, "PE", "BUY")];
    case "ORB_DIRECTIONAL":
    case "MOMENTUM_BUY": {
      const bullish = ctx.direction === "BEARISH" ? false : true;
      return bullish ? [mk(atm, "CE", "BUY")] : [mk(atm, "PE", "BUY")];
    }
    case "SHORT_CALENDAR_STRADDLE":
      return [
        mk(atm, "CE", "SELL", ctx.expiryNear),
        mk(atm, "PE", "SELL", ctx.expiryNear),
        mk(atm, "CE", "BUY", ctx.expiryFar),
        mk(atm, "PE", "BUY", ctx.expiryFar),
      ];
    default:
      return [];
  }
}
