// Classical chart-pattern detectors.
// Sources: NCFE/IIFM "Price Pattern Identification" deck + Fidelity
// "Identifying Chart Patterns". Reversal: triple top/bottom, diamond, rounded,
// cup & handle. Continuation: triangles, wedges, channel/rectangle, flags,
// pennants. Short-term: key reversal, inside/outside bar, the four gap types
// and island reversals.
//
// Every detector evaluates the LAST completed candle against prior structure
// only — a signal is actionable at that candle's close, with explicit
// entry / SL / target levels.

import {
  atr,
  buf,
  findPivots,
  fmt,
  lineVal,
  midOf,
  resolveParams,
  slopeOf,
  trendPct,
  type LinePt,
  type Params,
  type Pivot,
} from "./helpers";
import type { Candle, Detector, PatternDef, PatternSignal } from "./types";

const MIN_FORM_BARS = 12; // a triangle/wedge needs some development before a break counts
const APEX_GUARD = 0.85; // breakout must occur before 85% of the way to the apex (NCFE)
const FLAT_K = 0.08; // |slope|/bar <= FLAT_K * ATR counts as a horizontal boundary

export const CHART_DEFS: PatternDef[] = [
  // ---------- reversals ----------
  {
    id: "TRIPLE_TOP",
    category: "CHART",
    label: "Triple Top",
    short: "3 equal highs break",
    desc: "Three highs at the same level with two troughs between — short the neckline breakdown, SL above the highs, height projected down (NCFE reversal).",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 3 },
      { key: "tolPct", label: "High symmetry ± %", min: 0.1, max: 3, step: 0.1, def: 0.7 },
      { key: "minSep", label: "Min bars between peaks", min: 3, max: 30, step: 1, def: 5 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "TRIPLE_BOTTOM",
    category: "CHART",
    label: "Triple Bottom",
    short: "3 equal lows break",
    desc: "Three lows at the same level with two peaks between — long the neckline breakout, SL under the lows, height projected up.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 3 },
      { key: "tolPct", label: "Low symmetry ± %", min: 0.1, max: 3, step: 0.1, def: 0.7 },
      { key: "minSep", label: "Min bars between troughs", min: 3, max: 30, step: 1, def: 5 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "DIAMOND_TOP",
    category: "CHART",
    label: "Diamond Top",
    short: "Widen then narrow",
    desc: "Range first widens then contracts into a diamond at a top — short the right-side (lower) boundary break; height of the diamond projected down.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 2 },
      { key: "maxSpan", label: "Max pattern bars", min: 20, max: 160, step: 5, def: 60 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "ROUNDED_BOTTOM",
    category: "CHART",
    label: "Rounded Bottom (Saucer)",
    short: "Smooth U breakout",
    desc: "Pivot lows curve down then up in a smooth saucer — long the close above the right rim; depth of the saucer projected up.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 3 },
      { key: "lookback", label: "Pattern window (bars)", min: 40, max: 250, step: 10, def: 120 },
      { key: "minPivots", label: "Min pivot lows", min: 4, max: 10, step: 1, def: 5 },
      { key: "depthPct", label: "Min depth %", min: 0.5, max: 10, step: 0.5, def: 2 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "ROUNDED_TOP",
    category: "CHART",
    label: "Rounded Top (Inverted Saucer)",
    short: "Smooth dome break",
    desc: "Pivot highs curve up then down in a smooth dome — short the close below the right rim; depth of the dome projected down.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 3 },
      { key: "lookback", label: "Pattern window (bars)", min: 40, max: 250, step: 10, def: 120 },
      { key: "minPivots", label: "Min pivot highs", min: 4, max: 10, step: 1, def: 5 },
      { key: "depthPct", label: "Min depth %", min: 0.5, max: 10, step: 0.5, def: 2 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "CUP_HANDLE",
    category: "CHART",
    label: "Cup & Handle",
    short: "U-base + handle",
    desc: "Round U-shaped base (cup) recovers to the rim, then a shallow handle drifts down — long the handle-high breakout with the cup depth projected up.",
    params: [
      { key: "lookback", label: "Pattern window (bars)", min: 60, max: 250, step: 10, def: 120 },
      { key: "depthPct", label: "Min cup depth %", min: 2, max: 25, step: 0.5, def: 6 },
      { key: "rimTolPct", label: "Rim match ± %", min: 0.5, max: 8, step: 0.25, def: 1.5 },
      { key: "handleFrac", label: "Max handle depth (× cup)", min: 0.15, max: 0.6, step: 0.05, def: 0.4 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  // ---------- triangles / wedges / channel ----------
  {
    id: "SYMMETRICAL_TRIANGLE",
    category: "CHART",
    label: "Symmetrical Triangle",
    short: "Converging coil",
    desc: "Lower highs and higher lows converge into a coil — trade the close beyond either boundary before the apex; height at the first reversal projected (NCFE 76-78% reliable).",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 2 },
      { key: "maxSpan", label: "Max pattern bars", min: 20, max: 160, step: 5, def: 60 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "ASCENDING_TRIANGLE",
    category: "CHART",
    label: "Ascending Triangle",
    short: "Flat top, rising lows",
    desc: "Horizontal resistance with rising lows (right-angle, bullish) — long the close above the flat top; height of the triangle projected up.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 2 },
      { key: "maxSpan", label: "Max pattern bars", min: 20, max: 160, step: 5, def: 60 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "DESCENDING_TRIANGLE",
    category: "CHART",
    label: "Descending Triangle",
    short: "Flat bottom, lower highs",
    desc: "Horizontal support with falling highs (right-angle, bearish) — short the close below the flat bottom; height of the triangle projected down.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 2 },
      { key: "maxSpan", label: "Max pattern bars", min: 20, max: 160, step: 5, def: 60 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "RISING_WEDGE",
    category: "CHART",
    label: "Rising Wedge",
    short: "Narrowing rally",
    desc: "Both boundaries rise but lows rise faster, squeezing into a wedge — short the downside break; SL above the last high, height projected down.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 2 },
      { key: "maxSpan", label: "Max pattern bars", min: 20, max: 160, step: 5, def: 60 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "FALLING_WEDGE",
    category: "CHART",
    label: "Falling Wedge",
    short: "Narrowing decline",
    desc: "Both boundaries fall but highs fall faster — bullish: long the close above the upper boundary; SL under the last low, height projected up.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 2 },
      { key: "maxSpan", label: "Max pattern bars", min: 20, max: 160, step: 5, def: 60 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "CHANNEL_BREAKOUT",
    category: "CHART",
    label: "Channel / Rectangle Breakout",
    short: "Parallel range break",
    desc: "Two parallel boundaries (rising, falling or flat rectangle) contain price — trade the close beyond either line; channel height projected in the break direction.",
    params: [
      { key: "pivot", label: "Pivot strength", min: 2, max: 6, step: 1, def: 2 },
      { key: "maxSpan", label: "Max pattern bars", min: 20, max: 160, step: 5, def: 70 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  // ---------- flags & pennants ----------
  {
    id: "BULL_FLAG",
    category: "CHART",
    label: "Bull Flag",
    short: "Pole + drift-down",
    desc: "Sharp up-pole (≥ ATR multiple) followed by a small, slightly downward consolidation — long the flag-high break; pole height projected up.",
    params: [
      { key: "poleAtr", label: "Pole ≥ ATR ×", min: 1, max: 8, step: 0.25, def: 2.5 },
      { key: "poleBars", label: "Max pole bars", min: 4, max: 30, step: 1, def: 12 },
      { key: "flagBars", label: "Max flag bars", min: 4, max: 40, step: 1, def: 20 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Pole projection ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "BEAR_FLAG",
    category: "CHART",
    label: "Bear Flag",
    short: "Pole + drift-up",
    desc: "Sharp down-pole followed by a small upward-drifting consolidation — short the flag-low break; pole height projected down.",
    params: [
      { key: "poleAtr", label: "Pole ≥ ATR ×", min: 1, max: 8, step: 0.25, def: 2.5 },
      { key: "poleBars", label: "Max pole bars", min: 4, max: 30, step: 1, def: 12 },
      { key: "flagBars", label: "Max flag bars", min: 4, max: 40, step: 1, def: 20 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Pole projection ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "BULL_PENNANT",
    category: "CHART",
    label: "Bull Pennant",
    short: "Pole + mini coil",
    desc: "Sharp up-pole then a tiny symmetrical coil (pennant) — long the upper boundary break; pole height projected up.",
    params: [
      { key: "poleAtr", label: "Pole ≥ ATR ×", min: 1, max: 8, step: 0.25, def: 2.5 },
      { key: "poleBars", label: "Max pole bars", min: 4, max: 30, step: 1, def: 12 },
      { key: "flagBars", label: "Max pennant bars", min: 4, max: 40, step: 1, def: 16 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Pole projection ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "BEAR_PENNANT",
    category: "CHART",
    label: "Bear Pennant",
    short: "Pole + mini coil",
    desc: "Sharp down-pole then a tiny symmetrical coil — short the lower boundary break; pole height projected down.",
    params: [
      { key: "poleAtr", label: "Pole ≥ ATR ×", min: 1, max: 8, step: 0.25, def: 2.5 },
      { key: "poleBars", label: "Max pole bars", min: 4, max: 30, step: 1, def: 12 },
      { key: "flagBars", label: "Max pennant bars", min: 4, max: 40, step: 1, def: 16 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Pole projection ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  // ---------- short-term bars & gaps ----------
  {
    id: "KEY_REVERSAL",
    category: "CHART",
    label: "Key Reversal Bar",
    short: "New high, lower close",
    desc: "After a directional run the bar makes a new extreme but closes beyond the prior close — NCFE minor trend change; SL beyond the reversal extreme.",
    params: [
      { key: "trendLookback", label: "Trend lookback (bars)", min: 5, max: 60, step: 1, def: 12 },
      { key: "trendPct", label: "Min prior trend %", min: 0.1, max: 5, step: 0.1, def: 0.5 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.25, def: 1.5 },
    ],
  },
  {
    id: "INSIDE_BAR_BREAKOUT",
    category: "CHART",
    label: "Inside Bar Breakout",
    short: "NR break of mother",
    desc: "A narrow inside bar rests within a wide mother bar, then price closes beyond its range — trade the break with the mother bar as SL anchor.",
    params: [
      { key: "minMotherAtr", label: "Mother range ≥ ATR ×", min: 0.5, max: 5, step: 0.25, def: 1 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.25, def: 1.5 },
    ],
  },
  {
    id: "OUTSIDE_BAR",
    category: "CHART",
    label: "Outside Bar (Engulfing Range)",
    short: "Range engulf, close wins",
    desc: "NCFE outside range: the bar engulfs the prior bar's full range — trade in the direction of its close, SL beyond the opposite extreme.",
    params: [
      { key: "minRangeAtr", label: "Bar range ≥ ATR ×", min: 0.5, max: 5, step: 0.25, def: 1.2 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.25, def: 1.2 },
    ],
  },
  {
    id: "BREAKAWAY_GAP",
    category: "CHART",
    label: "Breakaway Gap",
    short: "Gap out of base",
    desc: "Price gaps out of a tight consolidation and holds beyond the gap — trade with the gap; SL back inside the base (NCFE: need not be filled).",
    params: [
      { key: "consLookback", label: "Base lookback (bars)", min: 10, max: 80, step: 5, def: 30 },
      { key: "rangePct", label: "Max base range %", min: 0.2, max: 6, step: 0.1, def: 1.2 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.25, def: 2 },
    ],
  },
  {
    id: "RUNAWAY_GAP",
    category: "CHART",
    label: "Runaway (Measuring) Gap",
    short: "Mid-trend gap",
    desc: "A gap inside an established trend — continuation in the gap direction with the move roughly half done (NCFE measuring gap).",
    params: [
      { key: "trendLookback", label: "Trend lookback (bars)", min: 10, max: 80, step: 5, def: 20 },
      { key: "trendPct", label: "Min prior trend %", min: 0.2, max: 8, step: 0.1, def: 1.2 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.25, def: 2 },
    ],
  },
  {
    id: "EXHAUSTION_GAP",
    category: "CHART",
    label: "Exhaustion Gap",
    short: "Late gap that fades",
    desc: "A gap at the end of an extended move whose candle closes back toward the gap — trade the reversal (NCFE: signals the move is spent).",
    params: [
      { key: "trendPct", label: "Min prior trend %", min: 0.5, max: 12, step: 0.25, def: 3 },
      { key: "fadeFrac", label: "Close within lower/upper ×", min: 0.1, max: 0.6, step: 0.05, def: 0.3 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.25, def: 1.5 },
    ],
  },
  {
    id: "ISLAND_REVERSAL",
    category: "CHART",
    label: "Island Reversal",
    short: "Gapped out both sides",
    desc: "Candles isolated by a gap in one direction then a gap back — the island marks the turn; trade against the island with SL beyond it.",
    params: [
      { key: "maxIsland", label: "Max island bars", min: 1, max: 12, step: 1, def: 6 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.25, def: 1.5 },
    ],
  },
];

// ---------- shared boundary machinery (triangles / wedges / channels) ----------

type BoundaryKind = "SYMM" | "ASC" | "DESC" | "RWEDGE" | "FWEDGE" | "CHANNEL";

interface Bounds {
  kind: BoundaryKind;
  up: [LinePt, LinePt];
  lo: [LinePt, LinePt];
  firstIdx: number;
}

function findBounds(window: Candle[], pivots: Pivot[], a: number): Bounds | null {
  const highs = pivots.filter((v) => v.type === "H");
  const lows = pivots.filter((v) => v.type === "L");
  if (highs.length < 2 || lows.length < 2) return null;
  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  // the four reversals must interleave to form two boundary lines (NCFE 4-point reversal)
  if (!(h1.idx < l2.idx && l1.idx < h2.idx)) return null;

  const up: [LinePt, LinePt] = [{ idx: h1.idx, price: h1.price }, { idx: h2.idx, price: h2.price }];
  const lo: [LinePt, LinePt] = [{ idx: l1.idx, price: l1.price }, { idx: l2.idx, price: l2.price }];
  const su = slopeOf(up[0], up[1]);
  const sl = slopeOf(lo[0], lo[1]);
  if (a <= 0) return null;
  const flatU = Math.abs(su) <= FLAT_K * a;
  const flatL = Math.abs(sl) <= FLAT_K * a;
  const converging = su < sl;

  let kind: BoundaryKind | null = null;
  if (su < 0 && sl > 0 && converging) kind = "SYMM";
  else if (flatU && sl > 0) kind = "ASC";
  else if (flatL && su < 0) kind = "DESC";
  else if (su > 0 && sl > 0 && converging) kind = "RWEDGE";
  else if (su < 0 && sl < 0 && converging) kind = "FWEDGE";
  else if (Math.abs(su - sl) <= 0.06 * a && Math.abs(su) + Math.abs(sl) > 2 * FLAT_K * a) kind = "CHANNEL";
  else if (flatU && flatL) kind = "CHANNEL"; // rectangle
  if (!kind) return null;

  return { kind, up, lo, firstIdx: Math.min(h1.idx, l1.idx) };
}

interface Break {
  side: "LONG" | "SHORT";
  entry: number;
  sl: number;
  target: number;
  ref: number;
  note: string;
}

function evaluateBounds(
  window: Candle[],
  candles: Candle[],
  bounds: Bounds,
  p: Params,
  kindLabel: string,
  allowed: { up: boolean; down: boolean },
): Break | null {
  const n = candles.length;
  const wn = window.length;
  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);

  // maturity + apex guard
  const developed = wn - 1 - bounds.firstIdx >= MIN_FORM_BARS;
  if (!developed) return null;
  const su = slopeOf(bounds.up[0], bounds.up[1]);
  const sl = slopeOf(bounds.lo[0], bounds.lo[1]);
  // apex via solving up(idx) = lo(idx)
  if (Math.abs(su - sl) > 1e-12) {
    const cu = bounds.up[0].price - su * bounds.up[0].idx;
    const cl = bounds.lo[0].price - sl * bounds.lo[0].idx;
    const apexIdx = (cl - cu) / (su - sl);
    const total = apexIdx - bounds.firstIdx;
    if (total > 0 && (wn - 1 - bounds.firstIdx) / total > APEX_GUARD) return null;
  }

  const upperNow = lineVal(bounds.up[0], bounds.up[1], wn - 1);
  const lowerNow = lineVal(bounds.lo[0], bounds.lo[1], wn - 1);
  const height = Math.abs(
    lineVal(bounds.up[0], bounds.up[1], bounds.firstIdx) - lineVal(bounds.lo[0], bounds.lo[1], bounds.firstIdx),
  );
  if (height <= 0) return null;

  const brokeUp = allowed.up && bar.c > upperNow + b && prev.c <= upperNow;
  const brokeDown = allowed.down && bar.c < lowerNow - b && prev.c >= lowerNow;
  if (!brokeUp && !brokeDown) return null;

  if (brokeUp) {
    const entry = bar.c;
    const slv = lowerNow - b;
    const target = entry + height * p.measured;
    if (target <= entry || slv >= entry) return null;
    return {
      side: "LONG",
      entry,
      sl: slv,
      target,
      ref: upperNow,
      note: `${kindLabel}: closed ${fmt(bar.c)} above upper boundary ${fmt(upperNow)} — ${fmt(height)} height projected up.`,
    };
  }
  const entry = bar.c;
  const slv = upperNow + b;
  const target = entry - height * p.measured;
  if (target >= entry || slv <= entry) return null;
  return {
    side: "SHORT",
    entry,
    sl: slv,
    target,
    ref: lowerNow,
    note: `${kindLabel}: closed ${fmt(bar.c)} below lower boundary ${fmt(lowerNow)} — ${fmt(height)} height projected down.`,
  };
}

interface FormationWin {
  window: Candle[];
  pivots: Pivot[];
  a: number;
}

function formationWindow(candles: Candle[], p: Params): FormationWin | null {
  const n = candles.length;
  const span = Math.min(Math.floor(p.maxSpan), n - 2);
  if (span < MIN_FORM_BARS + 8) return null;
  const window = candles.slice(n - span);
  const a = atr(candles, 14, n - 1);
  if (a <= 0) return null;
  const pivots = findPivots(window, Math.floor(p.pivot), window.length - 1);
  return { window, pivots, a };
}

function detectBounded(
  candles: Candle[],
  p: Params,
  kinds: BoundaryKind[],
  kindLabel: string,
  allowed: { up: boolean; down: boolean },
): PatternSignal | null {
  const win = formationWindow(candles, p);
  if (!win) return null;
  const bounds = findBounds(win.window, win.pivots, win.a);
  if (!bounds || !kinds.includes(bounds.kind)) return null;
  const br = evaluateBounds(win.window, candles, bounds, p, kindLabel, allowed);
  return br ? { ...br } : null;
}

// ---------- reversal detectors ----------

function detectTripleTop(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const strength = Math.floor(p.pivot);
  if (n < strength * 2 + 24) return null;
  const pivots = findPivots(candles, strength, n - 1);
  const highs = pivots.filter((v) => v.type === "H");
  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);

  for (let i = highs.length - 3; i >= Math.max(0, highs.length - 10); i--) {
    const h1 = highs[i];
    const h2 = highs[i + 1];
    const h3 = highs[i + 2];
    if (h3.idx - h1.idx < Math.floor(p.minSep) * 2) continue;
    const maxH = Math.max(h1.price, h2.price, h3.price);
    if (maxH <= 0) continue;
    if (Math.abs(h1.price - h2.price) / maxH > p.tolPct / 100) continue;
    if (Math.abs(h2.price - h3.price) / maxH > p.tolPct / 100) continue;
    let t1 = Infinity;
    let t2 = Infinity;
    for (let k = h1.idx; k <= h2.idx; k++) t1 = Math.min(t1, candles[k].l);
    for (let k = h2.idx; k <= h3.idx; k++) t2 = Math.min(t2, candles[k].l);
    const neck = Math.min(t1, t2);
    if (bar.c < neck && prev.c >= neck) {
      const entry = bar.c;
      const slv = maxH + b;
      const target = entry - (maxH - neck) * p.measured;
      if (target < entry) {
        return {
          side: "SHORT",
          entry,
          sl: slv,
          target,
          ref: neck,
          note: `Triple top ${fmt(h1.price)} / ${fmt(h2.price)} / ${fmt(h3.price)} — neckline ${fmt(neck)} broke; height projected down.`,
        };
      }
    }
  }
  return null;
}

function detectTripleBottom(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const strength = Math.floor(p.pivot);
  if (n < strength * 2 + 24) return null;
  const pivots = findPivots(candles, strength, n - 1);
  const lows = pivots.filter((v) => v.type === "L");
  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);

  for (let i = lows.length - 3; i >= Math.max(0, lows.length - 10); i--) {
    const l1 = lows[i];
    const l2 = lows[i + 1];
    const l3 = lows[i + 2];
    if (l3.idx - l1.idx < Math.floor(p.minSep) * 2) continue;
    const minL = Math.min(l1.price, l2.price, l3.price);
    if (minL <= 0) continue;
    if (Math.abs(l1.price - l2.price) / minL > p.tolPct / 100) continue;
    if (Math.abs(l2.price - l3.price) / minL > p.tolPct / 100) continue;
    let t1 = -Infinity;
    let t2 = -Infinity;
    for (let k = l1.idx; k <= l2.idx; k++) t1 = Math.max(t1, candles[k].h);
    for (let k = l2.idx; k <= l3.idx; k++) t2 = Math.max(t2, candles[k].h);
    const neck = Math.max(t1, t2);
    if (bar.c > neck && prev.c <= neck) {
      const entry = bar.c;
      const slv = minL - b;
      const target = entry + (neck - minL) * p.measured;
      if (target > entry) {
        return {
          side: "LONG",
          entry,
          sl: slv,
          target,
          ref: neck,
          note: `Triple bottom ${fmt(l1.price)} / ${fmt(l2.price)} / ${fmt(l3.price)} — neckline ${fmt(neck)} reclaimed; height projected up.`,
        };
      }
    }
  }
  return null;
}

function detectDiamondTop(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const strength = Math.floor(p.pivot);
  const span = Math.min(Math.floor(p.maxSpan), n - 2);
  if (span < 24) return null;
  const window = candles.slice(n - span);
  const pivots = findPivots(window, strength, window.length - 1);
  if (pivots.length < 6) return null;
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);

  for (let s = pivots.length - 6; s >= Math.max(0, pivots.length - 10); s--) {
    const w = pivots.slice(s, s + 6);
    const [v0, v1, v2, v3, v4, v5] = w;
    if (!v0 || !v1 || !v2 || !v3 || !v4 || !v5) continue;
    // H1 L1 H2 L2 H3 L3 — expand into H2/L2, contract into H3/L3
    if (!(v0.type === "H" && v1.type === "L" && v2.type === "H" && v3.type === "L" && v4.type === "H" && v5.type === "L")) continue;
    const h1 = v0.price, l1 = v1.price, h2 = v2.price, l2 = v3.price, h3 = v4.price, l3 = v5.price;
    const wide = h2 - l2;
    const before = h1 - l1;
    const after = h3 - l3;
    if (!(h2 > h1 && l2 < l1 && h3 < h2 && l3 > l2)) continue;
    if (!(wide > before && wide > after && before > 0 && after > 0)) continue;
    if (bar.c < l3 - b) {
      const entry = bar.c;
      const slv = h3 + b;
      const target = entry - wide * p.measured;
      if (target < entry) {
        return {
          side: "SHORT",
          entry,
          sl: slv,
          target,
          ref: l3,
          note: `Diamond top: range widened to ${fmt(wide)} then contracted — right boundary ${fmt(l3)} broke down.`,
        };
      }
    }
  }
  return null;
}

function detectRounded(candles: Candle[], p: Params, top: boolean): PatternSignal | null {
  const n = candles.length;
  const strength = Math.floor(p.pivot);
  const lookback = Math.min(Math.floor(p.lookback), n - 2);
  if (lookback < 30) return null;
  const window = candles.slice(n - lookback);
  const pivots = findPivots(window, strength, window.length - 1);
  const piv = pivots.filter((v) => v.type === (top ? "H" : "L"));
  if (piv.length < Math.floor(p.minPivots)) return null;
  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);

  for (let m = Math.floor(p.minPivots); m <= Math.min(piv.length, 8); m++) {
    for (let s = piv.length - m; s >= Math.max(0, piv.length - 6); s--) {
      const seg = piv.slice(s, s + m);
      if (seg.length < m) continue;
      // extremum must sit strictly inside the arc with >= 2 pivots curving in on each side
      if (m < 5) continue;
      const extremePos = top
        ? seg.reduce((best, v, i2) => (v.price > seg[best].price ? i2 : best), 0)
        : seg.reduce((best, v, i2) => (v.price < seg[best].price ? i2 : best), 0);
      if (extremePos < 2 || extremePos > seg.length - 3) continue;
      const ext = seg[extremePos].price;
      const left = seg.slice(0, extremePos);
      const right = seg.slice(extremePos + 1);
      const okShape = top
        ? left.every((v, i2) => i2 === 0 || v.price > left[i2 - 1].price) &&
          right.every((v, i2) => i2 === 0 || v.price < right[i2 - 1].price)
        : left.every((v, i2) => i2 === 0 || v.price < left[i2 - 1].price) &&
          right.every((v, i2) => i2 === 0 || v.price > right[i2 - 1].price);
      if (!okShape) continue;
      const endAvg = (seg[0].price + seg[seg.length - 1].price) / 2;
      const depth = Math.abs(endAvg - ext) / Math.max(endAvg, 1e-9);
      if (depth * 100 < p.depthPct) continue;
      // rim = extreme high/low of the price path after the arc's last pivot
      const fromIdx = seg[seg.length - 1].idx;
      let rim = top ? -Infinity : Infinity;
      for (let k = fromIdx; k < window.length; k++) {
        rim = top ? Math.max(rim, window[k].h) : Math.min(rim, window[k].l);
      }
      if (top) {
        if (bar.c < rim && prev.c >= rim) {
          const entry = bar.c;
          const slv = ext + b;
          const target = entry - Math.abs(rim - ext) * p.measured;
          if (target < entry) {
            return {
              side: "SHORT",
              entry,
              sl: slv,
              target,
              ref: rim,
              note: `Rounded top: ${m} pivot highs curve over a ${(depth * 100).toFixed(1)}% dome — rim ${fmt(rim)} lost.`,
            };
          }
        }
      } else {
        if (bar.c > rim && prev.c <= rim) {
          const entry = bar.c;
          const slv = ext - b;
          const target = entry + Math.abs(rim - ext) * p.measured;
          if (target > entry) {
            return {
              side: "LONG",
              entry,
              sl: slv,
              target,
              ref: rim,
              note: `Rounded bottom: ${m} pivot lows curve through a ${(depth * 100).toFixed(1)}% saucer — rim ${fmt(rim)} reclaimed.`,
            };
          }
        }
      }
    }
  }
  return null;
}

function detectRoundedBottom(candles: Candle[], p: Params): PatternSignal | null {
  return detectRounded(candles, p, false);
}

function detectRoundedTop(candles: Candle[], p: Params): PatternSignal | null {
  return detectRounded(candles, p, true);
}

function detectCupHandle(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const lookback = Math.min(Math.floor(p.lookback), n - 3);
  if (lookback < 50) return null;
  const w0 = n - lookback;
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);

  const thirdStart = Math.floor(lookback * 0.35);
  let rimL = -Infinity;
  let rimLIdx = -1;
  for (let k = w0; k < w0 + thirdStart; k++) {
    if (candles[k].h > rimL) { rimL = candles[k].h; rimLIdx = k; }
  }
  const searchEnd = n - 3; // keep the last bars for the handle / trigger
  let rimR = -Infinity;
  let rimRIdx = -1;
  for (let k = w0 + thirdStart; k <= searchEnd; k++) {
    if (candles[k].h > rimR) { rimR = candles[k].h; rimRIdx = k; }
  }
  if (rimLIdx < 0 || rimRIdx <= rimLIdx + 14) return null;
  if (rimL <= 0 || Math.abs(rimR / rimL - 1) > p.rimTolPct / 100) return null;

  let bottom = Infinity;
  let bottomIdx = -1;
  for (let k = rimLIdx; k <= rimRIdx; k++) {
    if (candles[k].l < bottom) { bottom = candles[k].l; bottomIdx = k; }
  }
  const pos = (bottomIdx - rimLIdx) / (rimRIdx - rimLIdx);
  if (pos < 0.2 || pos > 0.85) return null;
  const depth = rimL - bottom;
  if (depth <= 0 || (depth / rimL) * 100 < p.depthPct) return null;

  // handle between the right rim and the bar before the trigger
  let handleLow = Infinity;
  let handleHigh = -Infinity;
  for (let k = rimRIdx + 1; k < n - 1; k++) {
    handleLow = Math.min(handleLow, candles[k].l);
    handleHigh = Math.max(handleHigh, candles[k].h);
  }
  const handleBars = n - 2 - rimRIdx;
  if (handleBars < 2) return null;
  const handleDepth = rimR - handleLow;
  if (handleDepth < 0 || handleDepth > depth * p.handleFrac) return null;
  if (handleLow < bottom + depth * 0.5) return null; // handle lives in the upper half

  const trigger = Math.max(rimR, handleHigh);
  if (bar.c > trigger + b) {
    const entry = bar.c;
    const slv = handleLow - b;
    const target = entry + depth * p.measured;
    if (target > entry && slv < entry) {
      return {
        side: "LONG",
        entry,
        sl: slv,
        target,
        ref: trigger,
        note: `Cup & handle: ${fmt(rimL)}–${fmt(bottom)} cup (depth ${(depth / rimL * 100).toFixed(1)}%), handle broke ${fmt(trigger)} — cup depth projected up.`,
      };
    }
  }
  return null;
}

// ---------- flags & pennants ----------

interface Pole {
  lo: number;
  hi: number;
  tipIdx: number; // the pole's far extreme (top of up-pole / bottom of down-pole)
  up: boolean;
}

function findPole(candles: Candle[], p: Params, a: number, up: boolean): Pole | null {
  const n = candles.length;
  const searchStart = Math.max(1, n - 1 - Math.floor(p.poleBars) - Math.floor(p.flagBars) - 2);
  // most recent qualifying pole wins: scan candidate pole tips from newest to oldest
  for (let m = n - 3; m >= searchStart; m--) {
    const poleStart = Math.max(0, m - Math.floor(p.poleBars));
    let hi = -Infinity;
    let hiIdx = -1;
    let lo = Infinity;
    let loIdx = -1;
    for (let j = poleStart; j <= m; j++) {
      if (candles[j].h > hi) { hi = candles[j].h; hiIdx = j; }
      if (candles[j].l < lo) { lo = candles[j].l; loIdx = j; }
    }
    const span = hi - lo;
    if (a <= 0 || span < p.poleAtr * a) continue;
    // the tip must be the extreme end of the pole (flag starts after it)
    if (up && hiIdx !== m) continue;
    if (!up && loIdx !== m) continue;
    // the impulse must originate in the earlier part of the pole, not at its end
    const baseIdx = up ? loIdx : hiIdx;
    if (baseIdx < 0 || baseIdx > poleStart + Math.floor((m - poleStart) * 0.75)) continue;
    // close near the far extreme — the impulse actually travelled
    const ok = up ? candles[m].c >= lo + 0.6 * span : candles[m].c <= lo + 0.4 * span;
    if (ok) return { lo, hi, tipIdx: m, up };
  }
  return null;
}

function detectFlagPennant(candles: Candle[], p: Params, up: boolean, pennant: boolean): PatternSignal | null {
  const n = candles.length;
  const a = atr(candles, 14, n - 1);
  if (a <= 0) return null;
  const pole = findPole(candles, p, a, up);
  if (!pole) return null;
  const flag = candles.slice(pole.tipIdx + 1, n - 1);
  if (flag.length < 3 || flag.length > Math.floor(p.flagBars)) return null;
  const fHi = Math.max(...flag.map((c) => c.h));
  const fLo = Math.min(...flag.map((c) => c.l));
  const poleSpan = pole.hi - pole.lo;
  if (poleSpan <= 0) return null;
  if (fHi - fLo > poleSpan * 0.55) return null; // consolidation stays small
  if (up && fLo < pole.lo + poleSpan * 0.45) return null; // pullback too deep
  if (!up && fHi > pole.hi - poleSpan * 0.45) return null;

  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);

  if (pennant) {
    // coil check: first-half range wider than second-half range
    const half = Math.floor(flag.length / 2);
    const fh = flag.slice(0, half);
    const sh = flag.slice(half);
    if (fh.length < 1 || sh.length < 1) return null;
    const h1 = Math.max(...fh.map((c) => c.h));
    const l1 = Math.min(...fh.map((c) => c.l));
    const h2 = Math.max(...sh.map((c) => c.h));
    const l2 = Math.min(...sh.map((c) => c.l));
    if (!(h2 < h1 && l2 > l1)) return null;
  }

  if (up) {
    if (bar.c > fHi + b && prev.c <= fHi + b) {
      const entry = bar.c;
      const slv = fLo - b;
      const target = entry + poleSpan * p.measured;
      if (target > entry) {
        return {
          side: "LONG",
          entry,
          sl: slv,
          target,
          ref: fHi,
          note: `${pennant ? "Bull pennant" : "Bull flag"}: pole ${fmt(pole.lo)}→${fmt(pole.hi)}, ${flag.length}-bar coil broke ${fmt(fHi)} — pole projected up.`,
        };
      }
    }
  } else {
    if (bar.c < fLo - b && prev.c >= fLo - b) {
      const entry = bar.c;
      const slv = fHi + b;
      const target = entry - poleSpan * p.measured;
      if (target < entry) {
        return {
          side: "SHORT",
          entry,
          sl: slv,
          target,
          ref: fLo,
          note: `${pennant ? "Bear pennant" : "Bear flag"}: pole ${fmt(pole.hi)}→${fmt(pole.lo)}, ${flag.length}-bar coil broke ${fmt(fLo)} — pole projected down.`,
        };
      }
    }
  }
  return null;
}

// ---------- short-term bars & gaps ----------

function detectKeyReversal(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  if (n < Math.max(8, Math.floor(p.trendLookback) + 3)) return null;
  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);
  const prior = trendPct(candles, Math.floor(p.trendLookback), n - 2);

  if (prior >= p.trendPct && bar.h > prev.h && bar.c < prev.c) {
    const entry = bar.c;
    const slv = bar.h + b;
    const target = entry - p.rr * (slv - entry);
    if (target < entry) {
      return {
        side: "SHORT",
        entry,
        sl: slv,
        target,
        ref: bar.h,
        note: `Key reversal: new high ${fmt(bar.h)} after +${prior.toFixed(2)}% run but closed below prior close — minor trend change (NCFE).`,
      };
    }
  }
  if (prior <= -p.trendPct && bar.l < prev.l && bar.c > prev.c) {
    const entry = bar.c;
    const slv = bar.l - b;
    const target = entry + p.rr * (entry - slv);
    if (target > entry) {
      return {
        side: "LONG",
        entry,
        sl: slv,
        target,
        ref: bar.l,
        note: `Key reversal: new low ${fmt(bar.l)} after ${prior.toFixed(2)}% fall but closed above prior close — minor trend change (NCFE).`,
      };
    }
  }
  return null;
}

function detectInsideBar(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  if (n < 5) return null;
  const a = atr(candles, 14, n - 2);
  if (a <= 0) return null;
  const mother = candles[n - 3];
  const inside = candles[n - 2];
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);
  if (mother.h - mother.l < p.minMotherAtr * a) return null;
  if (!(inside.h < mother.h && inside.l > mother.l)) return null;

  if (bar.c > inside.h + b) {
    const entry = bar.c;
    const slv = inside.l - b;
    const target = entry + p.rr * (entry - slv);
    if (target > entry) {
      return {
        side: "LONG",
        entry,
        sl: slv,
        target,
        ref: inside.h,
        note: `Inside bar breakout: closed above the mother/inside high ${fmt(inside.h)} — momentum continuation.`,
      };
    }
  }
  if (bar.c < inside.l - b) {
    const entry = bar.c;
    const slv = inside.h + b;
    const target = entry - p.rr * (slv - entry);
    if (target < entry) {
      return {
        side: "SHORT",
        entry,
        sl: slv,
        target,
        ref: inside.l,
        note: `Inside bar breakdown: closed below the mother/inside low ${fmt(inside.l)} — momentum continuation.`,
      };
    }
  }
  return null;
}

function detectOutsideBar(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  if (n < 4) return null;
  const a = atr(candles, 14, n - 1);
  if (a <= 0) return null;
  const prev = candles[n - 2];
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);
  if (bar.h - bar.l < p.minRangeAtr * a) return null;
  if (!(bar.h > prev.h && bar.l < prev.l)) return null;
  const mid = midOf(bar);

  if (bar.c > mid) {
    const entry = bar.c;
    const slv = bar.l - b;
    const target = entry + p.rr * (entry - slv);
    if (target > entry) {
      return {
        side: "LONG",
        entry,
        sl: slv,
        target,
        ref: bar.h,
        note: `Outside bar engulfed ${fmt(prev.l)}–${fmt(prev.h)} and closed upper half — demand won the range war.`,
      };
    }
  } else {
    const entry = bar.c;
    const slv = bar.h + b;
    const target = entry - p.rr * (slv - entry);
    if (target < entry) {
      return {
        side: "SHORT",
        entry,
        sl: slv,
        target,
        ref: bar.l,
        note: `Outside bar engulfed ${fmt(prev.l)}–${fmt(prev.h)} and closed lower half — supply won the range war.`,
      };
    }
  }
  return null;
}

function baseRangePct(candles: Candle[], from: number, to: number): number | null {
  let hi = -Infinity;
  let lo = Infinity;
  let sum = 0;
  for (let k = from; k <= to; k++) {
    hi = Math.max(hi, candles[k].h);
    lo = Math.min(lo, candles[k].l);
    sum += candles[k].c;
  }
  const avg = sum / (to - from + 1);
  return avg > 0 ? ((hi - lo) / avg) * 100 : null;
}

function detectBreakawayGap(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const lb = Math.floor(p.consLookback);
  if (n < lb + 4) return null;
  const prev = candles[n - 2];
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);
  const from = n - 2 - lb;

  const gapUp = bar.o > prev.h;
  const gapDn = bar.o < prev.l;
  if (!gapUp && !gapDn) return null;
  const rangePct = baseRangePct(candles, from, n - 2);
  if (rangePct === null || rangePct > p.rangePct) return null;

  if (gapUp && bar.c > prev.h) {
    const entry = bar.c;
    const slv = Math.min(bar.l, prev.h) - b;
    const target = entry + p.rr * (entry - slv);
    if (target > entry) {
      return {
        side: "LONG",
        entry,
        sl: slv,
        target,
        ref: prev.h,
        note: `Breakaway gap: opened ${fmt(bar.o)} above the ${(n - 2 - from)}-bar base (range ${rangePct.toFixed(2)}%) and held — new impulse leg.`,
      };
    }
  }
  if (gapDn && bar.c < prev.l) {
    const entry = bar.c;
    const slv = Math.max(bar.h, prev.l) + b;
    const target = entry - p.rr * (slv - entry);
    if (target < entry) {
      return {
        side: "SHORT",
        entry,
        sl: slv,
        target,
        ref: prev.l,
        note: `Breakaway gap: opened ${fmt(bar.o)} below the ${(n - 2 - from)}-bar base (range ${rangePct.toFixed(2)}%) and held — new impulse leg.`,
      };
    }
  }
  return null;
}

function detectRunawayGap(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const lb = Math.floor(p.trendLookback);
  if (n < lb + 4) return null;
  const prev = candles[n - 2];
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);
  const prior = trendPct(candles, lb, n - 2);

  if (bar.o > prev.h && prior >= p.trendPct && bar.c > prev.h) {
    const entry = bar.c;
    const slv = Math.min(bar.l, prev.h) - b;
    const target = entry + p.rr * (entry - slv);
    if (target > entry) {
      return {
        side: "LONG",
        entry,
        sl: slv,
        target,
        ref: prev.h,
        note: `Runaway gap: +${prior.toFixed(2)}% trend gapped up ${fmt(bar.o)} and held — measuring gap, continuation.`,
      };
    }
  }
  if (bar.o < prev.l && prior <= -p.trendPct && bar.c < prev.l) {
    const entry = bar.c;
    const slv = Math.max(bar.h, prev.l) + b;
    const target = entry - p.rr * (slv - entry);
    if (target < entry) {
      return {
        side: "SHORT",
        entry,
        sl: slv,
        target,
        ref: prev.l,
        note: `Runaway gap: ${prior.toFixed(2)}% trend gapped down ${fmt(bar.o)} and held — measuring gap, continuation.`,
      };
    }
  }
  return null;
}

function detectExhaustionGap(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  if (n < 12) return null;
  const prev = candles[n - 2];
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);
  const prior = trendPct(candles, 14, n - 2);
  const rng = bar.h - bar.o;

  if (bar.o > prev.h && prior >= p.trendPct) {
    // faded: close back inside the gap area
    if (bar.c < bar.o + p.fadeFrac * rng) {
      const entry = bar.c;
      const slv = bar.h + b;
      const target = entry - p.rr * (slv - entry);
      if (target < entry) {
        return {
          side: "SHORT",
          entry,
          sl: slv,
          target,
          ref: bar.o,
          note: `Exhaustion gap: +${prior.toFixed(2)}% run gapped up ${fmt(bar.o)} then closed back at ${fmt(bar.c)} — move spent.`,
        };
      }
    }
  }
  if (bar.o < prev.l && prior <= -p.trendPct) {
    const rngDn = bar.o - bar.l;
    if (bar.c > bar.o - p.fadeFrac * rngDn) {
      const entry = bar.c;
      const slv = bar.l - b;
      const target = entry + p.rr * (entry - slv);
      if (target > entry) {
        return {
          side: "LONG",
          entry,
          sl: slv,
          target,
          ref: bar.o,
          note: `Exhaustion gap: ${prior.toFixed(2)}% slide gapped down ${fmt(bar.o)} then closed back at ${fmt(bar.c)} — selling spent.`,
        };
      }
    }
  }
  return null;
}

function detectIslandReversal(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const maxIsland = Math.floor(p.maxIsland);
  if (n < maxIsland + 4) return null;
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);

  for (let i = n - 3; i >= n - 2 - maxIsland && i >= 1; i--) {
    // island top: gap up into the island, gap down out of it
    const gapIn = candles[i].o > candles[i - 1].h;
    const gapOut = bar.o < candles[n - 2].l;
    if (!gapIn || !gapOut) continue;
    let islHi = -Infinity;
    let islLo = Infinity;
    for (let k = i; k <= n - 2; k++) {
      islHi = Math.max(islHi, candles[k].h);
      islLo = Math.min(islLo, candles[k].l);
    }
    if (islLo > candles[i - 1].h && bar.o < islLo) {
      const entry = bar.c;
      const slv = islHi + b;
      const target = entry - p.rr * (slv - entry);
      if (target < entry) {
        return {
          side: "SHORT",
          entry,
          sl: slv,
          target,
          ref: islLo,
          note: `Island top: ${n - 1 - i} candles isolated between gaps ${fmt(candles[i].o)} and ${fmt(bar.o)} — reversal down.`,
        };
      }
    }
    // island bottom: gap down into the island, gap up out of it
    const gapInDn = candles[i].o < candles[i - 1].l;
    const gapOutUp = bar.o > candles[n - 2].h;
    if (!gapInDn || !gapOutUp) continue;
    let islHi2 = -Infinity;
    let islLo2 = Infinity;
    for (let k = i; k <= n - 2; k++) {
      islHi2 = Math.max(islHi2, candles[k].h);
      islLo2 = Math.min(islLo2, candles[k].l);
    }
    if (islHi2 < candles[i - 1].l && bar.o > islHi2) {
      const entry = bar.c;
      const slv = islLo2 - b;
      const target = entry + p.rr * (entry - slv);
      if (target > entry) {
        return {
          side: "LONG",
          entry,
          sl: slv,
          target,
          ref: islHi2,
          note: `Island bottom: ${n - 1 - i} candles isolated between gaps ${fmt(candles[i].o)} and ${fmt(bar.o)} — reversal up.`,
        };
      }
    }
  }
  return null;
}

export const CHART_DETECTORS: Partial<Record<string, Detector>> = {
  TRIPLE_TOP: detectTripleTop,
  TRIPLE_BOTTOM: detectTripleBottom,
  DIAMOND_TOP: detectDiamondTop,
  ROUNDED_BOTTOM: detectRoundedBottom,
  ROUNDED_TOP: detectRoundedTop,
  CUP_HANDLE: detectCupHandle,
  SYMMETRICAL_TRIANGLE: (c, p) => detectBounded(c, p, ["SYMM"], "Symmetrical triangle", { up: true, down: true }),
  ASCENDING_TRIANGLE: (c, p) => detectBounded(c, p, ["ASC"], "Ascending triangle", { up: true, down: false }),
  DESCENDING_TRIANGLE: (c, p) => detectBounded(c, p, ["DESC"], "Descending triangle", { up: false, down: true }),
  RISING_WEDGE: (c, p) => detectBounded(c, p, ["RWEDGE"], "Rising wedge", { up: false, down: true }),
  FALLING_WEDGE: (c, p) => detectBounded(c, p, ["FWEDGE"], "Falling wedge", { up: true, down: false }),
  CHANNEL_BREAKOUT: (c, p) => detectBounded(c, p, ["CHANNEL"], "Channel", { up: true, down: true }),
  BULL_FLAG: (c, p) => detectFlagPennant(c, p, true, false),
  BEAR_FLAG: (c, p) => detectFlagPennant(c, p, false, false),
  BULL_PENNANT: (c, p) => detectFlagPennant(c, p, true, true),
  BEAR_PENNANT: (c, p) => detectFlagPennant(c, p, false, true),
  KEY_REVERSAL: detectKeyReversal,
  INSIDE_BAR_BREAKOUT: detectInsideBar,
  OUTSIDE_BAR: detectOutsideBar,
  BREAKAWAY_GAP: detectBreakawayGap,
  RUNAWAY_GAP: detectRunawayGap,
  EXHAUSTION_GAP: detectExhaustionGap,
  ISLAND_REVERSAL: detectIslandReversal,
};

export const CHART_PARAMS = CHART_DEFS.map((d) => [d.id, resolveParams(d.params)] as const);
