// Pattern library registry.
// Re-exports the shared types and assembles every detector from the three
// category modules. The scanner, its API route and the UI all consume this
// single surface.

import { CANDLESTICK_DEFS, CANDLESTICK_DETECTORS } from "./candlestick";
import { CHART_DEFS, CHART_DETECTORS } from "./chart";
import { PRICE_ACTION_DEFS, PRICE_ACTION_DETECTORS } from "./price-action";
import {
  PATTERN_CATEGORIES,
  type Candle,
  type Detector,
  type PatternCategory,
  type PatternDef,
  type PatternId,
  type PatternParamDef,
  type PatternSide,
  type PatternSignal,
} from "./types";

export type { Candle, PatternCategory, PatternDef, PatternId, PatternParamDef, PatternSide, PatternSignal };
export { PATTERN_CATEGORIES };

export const PATTERN_DEFS: PatternDef[] = [
  ...PRICE_ACTION_DEFS,
  ...CHART_DEFS,
  ...CANDLESTICK_DEFS,
];

export const PATTERN_MAP: Record<string, PatternDef> = Object.fromEntries(
  PATTERN_DEFS.map((p) => [p.id, p]),
);

const DETECTORS: Record<string, Detector> = {
  ...PRICE_ACTION_DETECTORS,
  ...CHART_DETECTORS,
  ...CANDLESTICK_DETECTORS,
} as Record<string, Detector>;

// fail fast at boot if a def is missing its detector (typo guard)
for (const def of PATTERN_DEFS) {
  if (!DETECTORS[def.id]) {
    throw new Error(`pattern ${def.id} has a def but no detector`);
  }
}

export const BASE_STRATEGY_IDS = ["ORB", "MOMENTUM"] as const;

/** Run every enabled pattern detector over the candle series.
 * Returns at most one signal per pattern id (the newest candle's setup). */
export function runPatternDetectors(
  candles: Candle[],
  enabled: PatternId[],
  overrides: Record<string, Record<string, number>> = {},
): Array<PatternSignal & { strategy: PatternId }> {
  const out: Array<PatternSignal & { strategy: PatternId }> = [];
  if (candles.length < 30) return out; // need history for pivots/ATR
  for (const id of enabled) {
    const def = PATTERN_MAP[id];
    if (!def) continue;
    const det = DETECTORS[id];
    if (!det) continue;
    const params = resolve(def, overrides[id]);
    let sig: PatternSignal | null = null;
    try {
      sig = det(candles, params);
    } catch {
      sig = null; // a malformed series must never take the scanner down
    }
    if (sig) out.push({ strategy: id, ...sig });
  }
  return out;
}

function resolve(def: PatternDef, overrides?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.def;
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      const pd: PatternParamDef | undefined = def.params.find((p) => p.key === k);
      if (pd && Number.isFinite(v) && v >= pd.min && v <= pd.max) out[k] = v;
    }
  }
  return out;
}

/** Validate a strategies CSV against all known scanner strategies. */
export function validStrategyIds(): string[] {
  return [...BASE_STRATEGY_IDS, ...PATTERN_DEFS.map((p) => p.id)];
}
