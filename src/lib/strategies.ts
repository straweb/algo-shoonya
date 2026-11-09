export type StrategyId =
  | "SHORT_STRADDLE_920"
  | "SHORT_STRANGLE"
  | "IRON_CONDOR"
  | "BULL_CALL_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "LONG_CALL"
  | "LONG_PUT"
  | "ORB_DIRECTIONAL"
  | "MOMENTUM_BUY"
  | "SHORT_CALENDAR_STRADDLE";

export type StrategyCategory = "OPTION SELLING" | "OPTION BUYING";
export type RiskTag = "HIGH" | "MEDIUM" | "LOW";

export interface StrategyDef {
  id: StrategyId;
  name: string;
  category: StrategyCategory;
  risk: RiskTag;
  tagline: string;
  description: string;
  legs: string;
  entryTime: string; // default IST hh:mm
  squareOffTime: string;
  direction: "AUTO" | "BULLISH" | "BEARISH";
  needsOtmGap: boolean;
  needsWingGap: boolean;
  needsDirection: boolean;
  calendar: boolean; // uses nearest + next expiry legs
}

export const STRATEGIES: Record<StrategyId, StrategyDef> = {
  SHORT_STRADDLE_920: {
    id: "SHORT_STRADDLE_920",
    name: "9:20 Short Straddle",
    category: "OPTION SELLING",
    risk: "HIGH",
    tagline: "Classic intraday theta harvest at the open",
    description:
      "Sells the ATM Call and ATM Put shortly after market open to capture the sharpest part of intraday theta decay. Best on low-gap days; protected by a per-leg premium stop-loss.",
    legs: "SELL ATM CE  •  SELL ATM PE",
    entryTime: "09:20",
    squareOffTime: "15:15",
    direction: "AUTO",
    needsOtmGap: false,
    needsWingGap: false,
    needsDirection: false,
    calendar: false,
  },
  SHORT_STRANGLE: {
    id: "SHORT_STRANGLE",
    name: "Short Strangle",
    category: "OPTION SELLING",
    risk: "HIGH",
    tagline: "Sell OTM wings, collect wider premium cushion",
    description:
      "Sells an OTM Call and OTM Call-equivalent Put around ATM. The buffer strikes reduce the odds of a wing being tested versus a straddle, at the cost of lower premium.",
    legs: "SELL (ATM + Gap) CE  •  SELL (ATM − Gap) PE",
    entryTime: "09:30",
    squareOffTime: "15:15",
    direction: "AUTO",
    needsOtmGap: true,
    needsWingGap: false,
    needsDirection: false,
    calendar: false,
  },
  IRON_CONDOR: {
    id: "IRON_CONDOR",
    name: "Iron Condor",
    category: "OPTION SELLING",
    risk: "MEDIUM",
    tagline: "Defined-risk range-bound premium selling",
    description:
      "Sells the OTM Call and Put and buys further wings on both sides. The bought wings cap the maximum loss of the position, making it margin-efficient and range-friendly.",
    legs: "SELL (ATM+G) CE · BUY (ATM+G+W) CE · SELL (ATM−G) PE · BUY (ATM−G−W) PE",
    entryTime: "09:30",
    squareOffTime: "15:15",
    direction: "AUTO",
    needsOtmGap: true,
    needsWingGap: true,
    needsDirection: false,
    calendar: false,
  },
  BULL_CALL_SPREAD: {
    id: "BULL_CALL_SPREAD",
    name: "Bull Call Spread",
    category: "OPTION BUYING",
    risk: "MEDIUM",
    tagline: "Limited-risk bullish debit spread",
    description:
      "Buys the ATM Call and finances part of it by selling an OTM Call. Profits when the index closes above the upper strike; loss is capped at the net debit paid.",
    legs: "BUY ATM CE  •  SELL (ATM + Gap) CE",
    entryTime: "09:30",
    squareOffTime: "15:15",
    direction: "BULLISH",
    needsOtmGap: true,
    needsWingGap: false,
    needsDirection: false,
    calendar: false,
  },
  BEAR_PUT_SPREAD: {
    id: "BEAR_PUT_SPREAD",
    name: "Bear Put Spread",
    category: "OPTION BUYING",
    risk: "MEDIUM",
    tagline: "Limited-risk bearish debit spread",
    description:
      "Buys the ATM Put and sells an OTM Put to reduce cost. Profits when the index moves below the lower strike; maximum loss limited to the net debit.",
    legs: "BUY ATM PE  •  SELL (ATM − Gap) PE",
    entryTime: "09:30",
    squareOffTime: "15:15",
    direction: "BEARISH",
    needsOtmGap: true,
    needsWingGap: false,
    needsDirection: false,
    calendar: false,
  },
  LONG_CALL: {
    id: "LONG_CALL",
    name: "Long Call (ATM Buy)",
    category: "OPTION BUYING",
    risk: "HIGH",
    tagline: "Pure directional long gamma play",
    description:
      "Buys the ATM Call of the selected index and holds it with a tight premium stop-loss. Unlimited upside to the strike plus premium paid.",
    legs: "BUY ATM CE",
    entryTime: "09:30",
    squareOffTime: "15:15",
    direction: "BULLISH",
    needsOtmGap: false,
    needsWingGap: false,
    needsDirection: false,
    calendar: false,
  },
  LONG_PUT: {
    id: "LONG_PUT",
    name: "Long Put (ATM Buy)",
    category: "OPTION BUYING",
    risk: "HIGH",
    tagline: "Pure directional short play on the index",
    description:
      "Buys the ATM Put of the selected index with a premium stop-loss. Unlimited downside protection play with risk limited to premium paid.",
    legs: "BUY ATM PE",
    entryTime: "09:30",
    squareOffTime: "15:15",
    direction: "BEARISH",
    needsOtmGap: false,
    needsWingGap: false,
    needsDirection: false,
    calendar: false,
  },
  ORB_DIRECTIONAL: {
    id: "ORB_DIRECTIONAL",
    name: "Opening Range Breakout",
    category: "OPTION BUYING",
    risk: "MEDIUM",
    tagline: "Buy strength or weakness right after the open",
    description:
      "At entry time the engine compares spot versus the day's opening price. A gap-up / rising market buys the ATM Call; a falling market buys the ATM Put.",
    legs: "BUY ATM CE if spot > day-open, else BUY ATM PE",
    entryTime: "09:45",
    squareOffTime: "15:15",
    direction: "AUTO",
    needsOtmGap: false,
    needsWingGap: false,
    needsDirection: false,
    calendar: false,
  },
  MOMENTUM_BUY: {
    id: "MOMENTUM_BUY",
    name: "Momentum Directional Buy",
    category: "OPTION BUYING",
    risk: "HIGH",
    tagline: "Late-morning momentum continuation entry",
    description:
      "Waits for the opening noise to settle, then buys the ATM Call or Put in the direction of the strongest move from the day's open, with a premium stop and target.",
    legs: "BUY ATM CE or PE (momentum side)",
    entryTime: "10:15",
    squareOffTime: "15:15",
    direction: "AUTO",
    needsOtmGap: false,
    needsWingGap: false,
    needsDirection: false,
    calendar: false,
  },
  SHORT_CALENDAR_STRADDLE: {
    id: "SHORT_CALENDAR_STRADDLE",
    name: "Short Calendar Straddle",
    category: "OPTION SELLING",
    risk: "MEDIUM",
    tagline: "Sell near expiry, hedge with far expiry",
    description:
      "Sells the nearest-expiry ATM straddle and buys the next-expiry ATM straddle against it. The long far legs cushion gamma blow-ups near expiry while keeping the theta edge.",
    legs: "SELL NEAREST ATM CE/PE  •  BUY NEXT ATM CE/PE",
    entryTime: "09:30",
    squareOffTime: "15:15",
    direction: "AUTO",
    needsOtmGap: false,
    needsWingGap: false,
    needsDirection: false,
    calendar: true,
  },
};

export const STRATEGY_LIST: StrategyDef[] = Object.values(STRATEGIES);

export function getStrategy(id: string): StrategyDef {
  const s = STRATEGIES[id as StrategyId];
  if (!s) throw new Error(`Unknown strategy ${id}`);
  return s;
}
