// Spot price-action pattern library — shared types.
//
// Every detector consumes completed OHLC candles (oldest first — index points
// or stock rupees, both are just "spot price") and, when the newest candle
// completes a setup, returns an explicit trade plan:
//   entry level  -> where the trade is taken
//   SL level     -> invalidation of the setup
//   target level -> measured move or R-multiple projection
// These levels are what the scanner trades against ("entry / target / SL strike").
//
// Catalog sources:
//  - Groww, "38 Candlestick Patterns Every Trader Should Know" (candlesticks)
//  - NCFE / IIFM, "Technical Analysis — Price Pattern Identification" (chart patterns)
//  - Fidelity, "Identifying Chart Patterns" (chart patterns)
//  - SMC price-action concepts (liquidity sweep, order block)

export interface Candle {
  t: number; // candle start epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
}

export type PatternSide = "LONG" | "SHORT";

export interface PatternSignal {
  side: PatternSide;
  entry: number;
  sl: number;
  target: number;
  ref: number; // the key structural level (swept swing / OB edge / neckline)
  note: string;
}

export type PatternCategory = "PRICE_ACTION" | "CHART" | "CANDLESTICK";

export interface PatternCategoryMeta {
  key: PatternCategory;
  label: string;
  blurb: string;
}

export const PATTERN_CATEGORIES: PatternCategoryMeta[] = [
  {
    key: "PRICE_ACTION",
    label: "Price Action (SMC)",
    blurb: "Structure-based setups: liquidity sweeps, order blocks, H&S, double top/bottom",
  },
  {
    key: "CHART",
    label: "Chart Patterns",
    blurb: "Classical reversal & continuation formations: triangles, wedges, flags, cup & handle, gaps",
  },
  {
    key: "CANDLESTICK",
    label: "Candlestick Patterns",
    blurb: "The full Japanese candlestick library — 1 to 5 candle reversal & continuation signals",
  },
];

export type PatternId =
  // price action
  | "LIQUIDITY_SWEEP"
  | "ORDER_BLOCK"
  | "HEAD_SHOULDERS"
  | "DOUBLE_BOTTOM"
  | "DOUBLE_TOP"
  // chart — reversal
  | "TRIPLE_TOP"
  | "TRIPLE_BOTTOM"
  | "DIAMOND_TOP"
  | "ROUNDED_TOP"
  | "ROUNDED_BOTTOM"
  | "CUP_HANDLE"
  // chart — triangles / wedges / channels
  | "SYMMETRICAL_TRIANGLE"
  | "ASCENDING_TRIANGLE"
  | "DESCENDING_TRIANGLE"
  | "RISING_WEDGE"
  | "FALLING_WEDGE"
  | "CHANNEL_BREAKOUT"
  // chart — flags & pennants
  | "BULL_FLAG"
  | "BEAR_FLAG"
  | "BULL_PENNANT"
  | "BEAR_PENNANT"
  // chart — short-term bars & gaps
  | "KEY_REVERSAL"
  | "INSIDE_BAR_BREAKOUT"
  | "OUTSIDE_BAR"
  | "BREAKAWAY_GAP"
  | "RUNAWAY_GAP"
  | "EXHAUSTION_GAP"
  | "ISLAND_REVERSAL"
  // candlestick — bullish
  | "HAMMER"
  | "INVERTED_HAMMER"
  | "BULL_ENGULFING"
  | "MORNING_STAR"
  | "PIERCING_LINE"
  | "BULL_HARAMI"
  | "THREE_WHITE_SOLDIERS"
  | "DRAGONFLY_DOJI"
  | "BULL_ABANDONED_BABY"
  | "THREE_INSIDE_UP"
  | "THREE_OUTSIDE_UP"
  | "BULL_KICKER"
  | "TWEEZER_BOTTOM"
  | "RISING_THREE_METHODS"
  | "CONCEALING_BABY_SWALLOW"
  | "BULL_MAT_HOLD"
  | "BULL_SEPARATING_LINES"
  | "BULL_BELT_HOLD"
  | "BULL_THREE_LINE_STRIKE"
  | "LADDER_BOTTOM"
  | "MEETING_LINES_BULL"
  // candlestick — bearish
  | "SHOOTING_STAR"
  | "HANGING_MAN"
  | "BEAR_ENGULFING"
  | "EVENING_STAR"
  | "DARK_CLOUD_COVER"
  | "BEAR_HARAMI"
  | "THREE_BLACK_CROWS"
  | "GRAVESTONE_DOJI"
  | "BEAR_ABANDONED_BABY"
  | "BEAR_THREE_INSIDE_DOWN"
  | "BEAR_THREE_OUTSIDE_DOWN"
  | "BEAR_KICKER"
  | "TWEEZER_TOP"
  | "FALLING_THREE_METHODS"
  | "UPSIDE_GAP_TWO_CROWS"
  | "BEAR_DOJI_STAR"
  | "BEAR_MAT_HOLD"
  | "BEAR_BELT_HOLD"
  | "BEAR_THREE_LINE_STRIKE"
  | "MEETING_LINES_BEAR";

export interface PatternParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

export interface PatternDef {
  id: PatternId;
  category: PatternCategory;
  label: string;
  short: string;
  desc: string;
  params: PatternParamDef[];
}

export type Detector = (candles: Candle[], p: Record<string, number>) => PatternSignal | null;
