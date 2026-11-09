// SMC / price-action detectors (original five).

import {
  atr,
  buf,
  findPivots,
  fmt,
  resolveParams,
  type Params,
} from "./helpers";
import type { Candle, Detector, PatternDef, PatternSignal } from "./types";

export const PRICE_ACTION_DEFS: PatternDef[] = [
  {
    id: "LIQUIDITY_SWEEP",
    category: "PRICE_ACTION",
    label: "Liquidity Sweep",
    short: "Sweep & reverse",
    desc: "Wick takes out a swing high/low (stop-run liquidity) but the candle closes back inside — trade the reversal with SL beyond the sweep wick.",
    params: [
      { key: "lookback", label: "Swing lookback (candles)", min: 20, max: 200, step: 10, def: 60 },
      { key: "pivot", label: "Pivot strength (bars each side)", min: 2, max: 8, step: 1, def: 3 },
      { key: "bufferPct", label: "Sweep buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.5, def: 2 },
    ],
  },
  {
    id: "ORDER_BLOCK",
    category: "PRICE_ACTION",
    label: "Order Block",
    short: "Displacement + retest",
    desc: "A displacement candle breaks the range and leaves the last opposite candle as an order block; price retesting that zone continues the move.",
    params: [
      { key: "atrMult", label: "Displacement ≥ ATR ×", min: 0.5, max: 5, step: 0.1, def: 2 },
      { key: "retraceBars", label: "Retest within (candles)", min: 5, max: 60, step: 1, def: 24 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.5, def: 2 },
    ],
  },
  {
    id: "HEAD_SHOULDERS",
    category: "PRICE_ACTION",
    label: "Head & Shoulders",
    short: "Neckline break",
    desc: "Classic H&S top / inverse bottom: head between two similar shoulders, confirmed on the neckline close-break; target is the measured move.",
    params: [
      { key: "pivot", label: "Pivot strength (bars each side)", min: 2, max: 6, step: 1, def: 3 },
      { key: "tolPct", label: "Shoulder symmetry ± %", min: 0.5, max: 10, step: 0.5, def: 2.5 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "DOUBLE_BOTTOM",
    category: "PRICE_ACTION",
    label: "Double Bottom",
    short: "W-breakout",
    desc: "Two similar lows form a W; long the neckline breakout with SL under the lows and the pattern height projected up.",
    params: [
      { key: "pivot", label: "Pivot strength (bars each side)", min: 2, max: 6, step: 1, def: 3 },
      { key: "tolPct", label: "Low symmetry ± %", min: 0.1, max: 3, step: 0.1, def: 0.6 },
      { key: "minSep", label: "Min bars between lows", min: 3, max: 30, step: 1, def: 5 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
  {
    id: "DOUBLE_TOP",
    category: "PRICE_ACTION",
    label: "Double Top",
    short: "M-breakdown",
    desc: "Two similar highs form an M; short the neckline breakdown with SL above the highs and the pattern height projected down.",
    params: [
      { key: "pivot", label: "Pivot strength (bars each side)", min: 2, max: 6, step: 1, def: 3 },
      { key: "tolPct", label: "High symmetry ± %", min: 0.1, max: 3, step: 0.1, def: 0.6 },
      { key: "minSep", label: "Min bars between highs", min: 3, max: 30, step: 1, def: 5 },
      { key: "bufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
      { key: "measured", label: "Measured-move ×", min: 0.5, max: 2, step: 0.1, def: 1 },
    ],
  },
];

// All detectors evaluate the LAST completed candle (index n-1) against prior
// structure only, so a signal is always actionable at that candle's close.

function detectLiquiditySweep(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const lookback = Math.min(Math.floor(p.lookback), n - 1);
  const window = candles.slice(n - lookback);
  const pivots = findPivots(window, Math.floor(p.pivot), window.length - 1);
  const bar = candles[n - 1];
  const b = buf(bar.c, p.bufferPct);

  // bullish: sweep of a pivot low, close back above it
  const sweptLows = pivots
    .filter((v) => v.type === "L" && v.idx < window.length - 1)
    .filter((v) => bar.l < v.price - b && bar.c > v.price)
    .sort((a, b2) => b2.idx - a.idx);
  if (sweptLows.length > 0) {
    const lvl = sweptLows[0].price;
    const entry = bar.c;
    const sl = bar.l - b;
    const target = entry + p.rr * (entry - sl);
    if (target > entry) {
      return {
        side: "LONG",
        entry,
        sl,
        target,
        ref: lvl,
        note: `Swept swing low ${fmt(lvl)} (wick ${fmt(bar.l)}) and closed back above — bullish liquidity sweep.`,
      };
    }
  }

  // bearish: sweep of a pivot high, close back below it
  const sweptHighs = pivots
    .filter((v) => v.type === "H" && v.idx < window.length - 1)
    .filter((v) => bar.h > v.price + b && bar.c < v.price)
    .sort((a, b2) => b2.idx - a.idx);
  if (sweptHighs.length > 0) {
    const lvl = sweptHighs[0].price;
    const entry = bar.c;
    const sl = bar.h + b;
    const target = entry - p.rr * (sl - entry);
    if (target < entry) {
      return {
        side: "SHORT",
        entry,
        sl,
        target,
        ref: lvl,
        note: `Swept swing high ${fmt(lvl)} (wick ${fmt(bar.h)}) and closed back below — bearish liquidity sweep.`,
      };
    }
  }
  return null;
}

function detectOrderBlock(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const bar = candles[n - 1];
  const a = atr(candles, 14, n - 1);
  if (a <= 0) return null;
  const scanFrom = Math.max(1, n - 1 - Math.floor(p.retraceBars) - 6);

  for (let j = n - 3; j >= scanFrom; j--) {
    // bullish OB: bearish candle j, then bullish displacement engulfing it
    const d = candles[j];
    const disp = candles[j + 1];
    if (
      d.c < d.o &&
      disp.c > disp.o &&
      disp.c - disp.o >= p.atrMult * a &&
      disp.c > d.h
    ) {
      const zoneHi = d.h;
      const zoneLo = d.l;
      // no invalidation close below zone, and no touch between the displacement
      // candle and the current bar (the displacement itself launches from the
      // zone, so only bars strictly after it count)
      let valid = true;
      let touched = false;
      for (let k = j + 2; k < n - 1; k++) {
        if (candles[k].c < zoneLo) { valid = false; break; }
        if (candles[k].l <= zoneHi) touched = true;
      }
      if (!valid || touched) continue;
      // first retest of the zone happens on the current bar
      if (bar.l <= zoneHi && bar.c > zoneLo) {
        const entry = bar.c;
        const sl = zoneLo - buf(bar.c, p.bufferPct);
        const target = entry + p.rr * (entry - sl);
        if (target > entry) {
          return {
            side: "LONG",
            entry,
            sl,
            target,
            ref: zoneHi,
            note: `Bullish order block ${fmt(zoneLo)}–${fmt(zoneHi)} (displacement ${((disp.c - disp.o) / a).toFixed(1)}× ATR) retested — long from the zone edge.`,
          };
        }
      }
    }
    // bearish OB: bullish candle j, then bearish displacement engulfing it
    if (
      d.c > d.o &&
      disp.c < disp.o &&
      disp.o - disp.c >= p.atrMult * a &&
      disp.c < d.l
    ) {
      const zoneHi = d.h;
      const zoneLo = d.l;
      let valid = true;
      let touched = false;
      for (let k = j + 2; k < n - 1; k++) {
        if (candles[k].c > zoneHi) { valid = false; break; }
        if (candles[k].h >= zoneLo) touched = true;
      }
      if (!valid || touched) continue;
      if (bar.h >= zoneLo && bar.c < zoneHi) {
        const entry = bar.c;
        const sl = zoneHi + buf(bar.c, p.bufferPct);
        const target = entry - p.rr * (sl - entry);
        if (target < entry) {
          return {
            side: "SHORT",
            entry,
            sl,
            target,
            ref: zoneLo,
            note: `Bearish order block ${fmt(zoneLo)}–${fmt(zoneHi)} (displacement ${((disp.o - disp.c) / a).toFixed(1)}× ATR) retested — short from the zone edge.`,
          };
        }
      }
    }
  }
  return null;
}

function detectHeadShoulders(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const strength = Math.floor(p.pivot);
  const pivots = findPivots(candles, strength, n - 1);
  if (pivots.length < 6) return null;
  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);

  // scan the last 6-pivot windows
  for (let s = pivots.length - 6; s >= 0 && s >= pivots.length - 12; s--) {
    const w = pivots.slice(s, s + 6);
    const [v0, v1, v2, v3, v4, v5] = w;
    if (!v0 || !v1 || !v2 || !v3 || !v4 || !v5) continue;

    // H&S top: L H(s1) L(t1) H(head) L(t2) H(s2)
    if (v0.type === "L" && v1.type === "H" && v2.type === "L" && v3.type === "H" && v4.type === "L" && v5.type === "H") {
      const s1 = v1.price, head = v3.price, s2 = v5.price;
      const avgS = (s1 + s2) / 2;
      const sym = Math.abs(s1 - s2) / avgS <= p.tolPct / 100;
      const headOk = head >= Math.max(s1, s2) * (1 + 0.0005);
      if (sym && headOk) {
        // neckline through troughs v2, v4, linearly projected to current bar
        const slope = (v4.price - v2.price) / (v4.idx - v2.idx);
        const neck = v2.price + slope * (n - 1 - v2.idx);
        if (bar.c < neck && prev.c >= neck) {
          const entry = bar.c;
          const sl = s2 + b;
          const target = neck - (head - neck) * p.measured;
          if (target < entry) {
            return {
              side: "SHORT",
              entry,
              sl,
              target,
              ref: neck,
              note: `H&S top: head ${fmt(head)}, shoulders ${fmt(s1)}/${fmt(s2)}, neckline broke at ${fmt(neck)} — measured move target.`,
            };
          }
        }
      }
    }

    // inverse H&S: H L(s1) H(t1) L(head) H(t2) L(s2)
    if (v0.type === "H" && v1.type === "L" && v2.type === "H" && v3.type === "L" && v4.type === "H" && v5.type === "L") {
      const s1 = v1.price, head = v3.price, s2 = v5.price;
      const avgS = (s1 + s2) / 2;
      const sym = Math.abs(s1 - s2) / avgS <= p.tolPct / 100;
      const headOk = head <= Math.min(s1, s2) * (1 - 0.0005);
      if (sym && headOk) {
        const slope = (v4.price - v2.price) / (v4.idx - v2.idx);
        const neck = v2.price + slope * (n - 1 - v2.idx);
        if (bar.c > neck && prev.c <= neck) {
          const entry = bar.c;
          const sl = s2 - b;
          const target = neck + (neck - head) * p.measured;
          if (target > entry) {
            return {
              side: "LONG",
              entry,
              sl,
              target,
              ref: neck,
              note: `Inverse H&S: head ${fmt(head)}, shoulders ${fmt(s1)}/${fmt(s2)}, neckline reclaimed at ${fmt(neck)} — measured move target.`,
            };
          }
        }
      }
    }
  }
  return null;
}

function detectDoubleBottom(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const strength = Math.floor(p.pivot);
  const pivots = findPivots(candles, strength, n - 1);
  const lows = pivots.filter((v) => v.type === "L");
  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);

  for (let i = lows.length - 2; i >= Math.max(0, lows.length - 8); i--) {
    const l1 = lows[i];
    const l2 = lows[i + 1];
    if (l2.idx - l1.idx < Math.floor(p.minSep)) continue;
    const minL = Math.min(l1.price, l2.price);
    if (Math.abs(l1.price - l2.price) / minL > p.tolPct / 100) continue;
    // neckline = highest high between the two lows
    let neck = -Infinity;
    for (let k = l1.idx; k <= l2.idx; k++) neck = Math.max(neck, candles[k].h);
    if (bar.c > neck && prev.c <= neck) {
      const entry = bar.c;
      const sl = minL - b;
      const target = entry + (neck - minL) * p.measured;
      if (target > entry) {
        return {
          side: "LONG",
          entry,
          sl,
          target,
          ref: neck,
          note: `Double bottom ${fmt(l1.price)} + ${fmt(l2.price)}, neckline ${fmt(neck)} broken — W measured move target.`,
        };
      }
    }
  }
  return null;
}

function detectDoubleTop(candles: Candle[], p: Params): PatternSignal | null {
  const n = candles.length;
  const strength = Math.floor(p.pivot);
  const pivots = findPivots(candles, strength, n - 1);
  const highs = pivots.filter((v) => v.type === "H");
  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const b = buf(bar.c, p.bufferPct);

  for (let i = highs.length - 2; i >= Math.max(0, highs.length - 8); i--) {
    const h1 = highs[i];
    const h2 = highs[i + 1];
    if (h2.idx - h1.idx < Math.floor(p.minSep)) continue;
    const maxH = Math.max(h1.price, h2.price);
    if (Math.abs(h1.price - h2.price) / maxH > p.tolPct / 100) continue;
    let neck = Infinity;
    for (let k = h1.idx; k <= h2.idx; k++) neck = Math.min(neck, candles[k].l);
    if (bar.c < neck && prev.c >= neck) {
      const entry = bar.c;
      const sl = maxH + b;
      const target = entry - (maxH - neck) * p.measured;
      if (target < entry) {
        return {
          side: "SHORT",
          entry,
          sl,
          target,
          ref: neck,
          note: `Double top ${fmt(h1.price)} + ${fmt(h2.price)}, neckline ${fmt(neck)} broken — M measured move target.`,
        };
      }
    }
  }
  return null;
}

export const PRICE_ACTION_DETECTORS: Partial<Record<string, Detector>> = {
  LIQUIDITY_SWEEP: detectLiquiditySweep,
  ORDER_BLOCK: detectOrderBlock,
  HEAD_SHOULDERS: detectHeadShoulders,
  DOUBLE_BOTTOM: detectDoubleBottom,
  DOUBLE_TOP: detectDoubleTop,
};

export const PRICE_ACTION_PARAMS = PRICE_ACTION_DEFS.map((d) => [d.id, resolveParams(d.params)] as const);
