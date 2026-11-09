// Shared geometry / statistics helpers for pattern detectors.

import type { Candle } from "./types";

export interface Pivot {
  idx: number;
  price: number;
  type: "H" | "L";
}

/** Fractal pivots: bar whose high/low is the extreme within `strength` bars each side. */
export function findPivots(candles: Candle[], strength: number, endIdx: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = strength; i < endIdx - strength; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isH = false;
      if (candles[j].l <= candles[i].l) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) pivots.push({ idx: i, price: candles[i].h, type: "H" });
    else if (isL) pivots.push({ idx: i, price: candles[i].l, type: "L" });
  }
  return pivots.sort((a, b) => a.idx - b.idx);
}

/** Average True Range over `period` bars ending at endIdx (exclusive). */
export function atr(candles: Candle[], period: number, endIdx: number): number {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(1, endIdx - period); i < endIdx; i++) {
    const prev = candles[i - 1].c;
    sum += Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - prev),
      Math.abs(candles[i].l - prev),
    );
    n++;
  }
  return n > 0 ? sum / n : 0;
}

export function buf(price: number, bufferPct: number): number {
  return (price * bufferPct) / 100;
}

/** Net % change of closes over the last `lookback` bars ending at endIdx (inclusive). */
export function trendPct(candles: Candle[], lookback: number, endIdx: number): number {
  const lb = Math.min(lookback, endIdx);
  const start = candles[endIdx - lb].c;
  const end = candles[endIdx].c;
  return start > 0 ? (end / start - 1) * 100 : 0;
}

export function avgBody(candles: Candle[], endIdx: number, period: number): number {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, endIdx - period); i < endIdx; i++) {
    sum += Math.abs(candles[i].c - candles[i].o);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

// ---------- candle anatomy ----------

export function bodyOf(c: Candle): number {
  return Math.abs(c.c - c.o);
}

export function isBull(c: Candle): boolean {
  return c.c > c.o;
}

export function isBear(c: Candle): boolean {
  return c.c < c.o;
}

export function rangeOf(c: Candle): number {
  return c.h - c.l;
}

export function upperWick(c: Candle): number {
  return c.h - Math.max(c.o, c.c);
}

export function lowerWick(c: Candle): number {
  return Math.min(c.o, c.c) - c.l;
}

export function midOf(c: Candle): number {
  return (c.o + c.c) / 2;
}

// ---------- trendline math ----------

export interface LinePt {
  idx: number;
  price: number;
}

/** Value of the straight line through points a→b at bar `atIdx`. */
export function lineVal(a: LinePt, b: LinePt, atIdx: number): number {
  if (b.idx === a.idx) return b.price;
  const slope = (b.price - a.price) / (b.idx - a.idx);
  return a.price + slope * (atIdx - a.idx);
}

export function slopeOf(a: LinePt, b: LinePt): number {
  if (b.idx === a.idx) return 0;
  return (b.price - a.price) / (b.idx - a.idx);
}

// ---------- params ----------

export type Params = Record<string, number>;

export function resolveParams(
  defs: { key: string; min: number; max: number; def: number }[],
  overrides?: Params,
): Params {
  const out: Params = {};
  for (const p of defs) out[p.key] = p.def;
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      const pd = defs.find((p) => p.key === k);
      if (pd && Number.isFinite(v) && v >= pd.min && v <= pd.max) out[k] = v;
    }
  }
  return out;
}

export function fmt(x: number): string {
  return `₹${x.toFixed(2)}`;
}
