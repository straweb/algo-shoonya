// Position sizing: % of allocated capital -> number of lots.
// Margin model (indicative, aligned with SPAN+exposure for short index options):
//   short leg  : 5% of index notional (spot x lot size)
//   hedged short (strategy also has long wings / spreads): 45% span discount
//   long leg   : full premium x lot size

import { getInstrument } from "./instruments";
import { buildLegs } from "./plan";
import { getStrategy, StrategyId } from "./strategies";
import { blackScholes } from "./pricing";
import { resolveExpiry } from "./instruments";

export interface SizingInput {
  strategyId: StrategyId;
  instrumentId: string;
  capital: number;
  utilizationPct: number;
  otmGap?: number;
  wingGap?: number;
  spot?: number; // optional override (live)
}

export interface SizingResult {
  lots: number;
  estMarginPerLot: number;
  estTotalMargin: number;
  estPremiumPerLot: number; // net premium (recv + / paid -) per lot
  capitalDeployable: number;
  sufficient: boolean;
  legsPreview: Array<{ symbol: string; side: string; strike: number; type: string; estPrice: number }>;
  spot: number;
  atm: number;
}

export function estimateSizing(input: SizingInput): SizingResult {
  const inst = getInstrument(input.instrumentId);
  const strat = getStrategy(input.strategyId);
  const spot = input.spot ?? inst.basePrice;
  const near = resolveExpiry(inst, "NEAREST").date;
  const far = resolveExpiry(inst, "NEXT").date;

  const premium = (strike: number, type: "CE" | "PE", expiry: Date) =>
    blackScholes({
      spot,
      strike,
      iv: inst.iv,
      yearsToExpiry: Math.max((expiry.getTime() + 10 * 3600000 - Date.now()) / (86400000 * 365), 0.00004),
      type,
    });

  const legs = buildLegs(strat.id, {
    inst,
    spot,
    otmGap: input.otmGap ?? 0,
    wingGap: input.wingGap ?? 0,
    direction: strat.direction,
    expiryNear: near,
    expiryFar: far,
  });

  const hasLongHedge = legs.some((l) => l.side === "BUY");
  let marginPerLot = 0;
  let netPremiumPerLot = 0;
  const legsPreview = legs.map((l) => {
    const exp = l.expiry === far && strat.calendar ? far : near;
    const px = premium(l.strike, l.optionType, exp);
    if (l.side === "SELL") {
      marginPerLot += 0.05 * spot * inst.lotSize * (hasLongHedge ? 0.55 : 1);
      netPremiumPerLot += px * inst.lotSize;
    } else {
      marginPerLot += px * inst.lotSize;
      netPremiumPerLot -= px * inst.lotSize;
    }
    return {
      symbol: l.symbol,
      side: l.side,
      strike: l.strike,
      type: l.optionType,
      estPrice: Math.round(px * 100) / 100,
    };
  });

  const deployable = (input.capital * input.utilizationPct) / 100;
  const sufficient = deployable >= marginPerLot;
  const lots = Math.max(sufficient ? Math.floor(deployable / marginPerLot) : 1, 1);

  return {
    lots,
    estMarginPerLot: Math.round(marginPerLot),
    estTotalMargin: Math.round(marginPerLot * lots),
    estPremiumPerLot: Math.round(netPremiumPerLot),
    capitalDeployable: Math.round(deployable),
    sufficient,
    legsPreview,
    spot: Math.round(spot * 100) / 100,
    atm: Math.round(spot / inst.strikeStep) * inst.strikeStep,
  };
}
