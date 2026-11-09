// Japanese candlestick pattern detectors — the full Groww catalog
// ("38 Candlestick Patterns Every Trader Should Know") plus the mirror
// Gravestone Doji, for 39 tradeable signals.
//
// Framework: every check runs on the LAST completed candle, requires the
// trend context from Groww (reversals only count against a real prior trend),
// and derives uniform levels:
//   entry  = trigger close
//   SL     = beyond the pattern's extreme (lowest low / highest high) ± buffer
//   target = entry ± rr × risk
//
// Shape thresholds are relative to the candle's own range and to the average
// body of the last 10 candles, so the same code works on indices and ₹100
// stocks alike.

import {
  atr,
  avgBody,
  bodyOf,
  buf,
  fmt,
  isBear,
  isBull,
  lowerWick,
  midOf,
  rangeOf,
  resolveParams,
  trendPct,
  upperWick,
  type Params,
} from "./helpers";
import type { Candle, Detector, PatternDef, PatternSide } from "./types";

// shape constants (fractions of range / average body)
const BODY_SMALL = 0.32; // hammer/star body ≤ 32% of range
const BODY_DOJI = 0.12; // doji body ≤ 12% of range
const LONG_BODY = 1.1; // "long" candle body ≥ 1.1× avg body
const VERY_LONG_BODY = 1.3;
const WICK_MAIN = 0.55; // dominant wick ≥ 55% of range
const WICK_OTHER = 0.15; // opposite wick ≤ 15% of range

/** Uniform parameter set shared by every candlestick pattern. */
export function csParams(): PatternDef["params"] {
  return [
    { key: "trendLookback", label: "Trend lookback (candles)", min: 5, max: 60, step: 1, def: 12 },
    { key: "trendPct", label: "Min prior trend %", min: 0.05, max: 3, step: 0.05, def: 0.3 },
    { key: "slBufferPct", label: "SL buffer %", min: 0, max: 0.5, step: 0.01, def: 0.05 },
    { key: "rr", label: "Target (R multiple)", min: 0.5, max: 5, step: 0.25, def: 1.5 },
  ];
}

interface CsCtx {
  a: number; // ATR(14)
  bodyAvg: number; // avg body of last 10 candles
  trend: number; // signed % change over trendLookback
  minTrend: number;
  long: number; // LONG_BODY × bodyAvg
  veryLong: number;
}

interface Hit {
  side: PatternSide;
  lows: number[];
  highs: number[];
  why: string;
}

type CsCheck = (cs: Candle[], i: number, x: CsCtx) => Hit | null;

function trendOk(x: CsCtx, dir: "UP" | "DOWN"): boolean {
  return dir === "UP" ? x.trend >= x.minTrend : x.trend <= -x.minTrend;
}

function makeCs(id: string, check: CsCheck): Detector {
  return (candles: Candle[], p: Params): PatternSignal2 | null => {
    const n = candles.length;
    const need = Math.max(8, Math.floor(p.trendLookback) + 4);
    if (n < need + 4) return null;
    const a = atr(candles, 14, n - 1);
    if (a <= 0) return null;
    const bodyAvg = avgBody(candles, n - 1, 10);
    if (bodyAvg <= 0) return null;
    const x: CsCtx = {
      a,
      bodyAvg,
      trend: trendPct(candles, Math.floor(p.trendLookback), n - 1),
      minTrend: p.trendPct,
      long: LONG_BODY * bodyAvg,
      veryLong: VERY_LONG_BODY * bodyAvg,
    };
    const hit = check(candles, n - 1, x);
    if (!hit) return null;
    const bar = candles[n - 1];
    const b = buf(bar.c, p.slBufferPct);
    if (hit.side === "LONG") {
      const sl = Math.min(...hit.lows) - b;
      const entry = bar.c;
      const target = entry + p.rr * (entry - sl);
      if (target <= entry || sl >= entry) return null;
      return { side: "LONG", entry, sl, target, ref: sl, note: hit.why };
    }
    const sl = Math.max(...hit.highs) + b;
    const entry = bar.c;
    const target = entry - p.rr * (sl - entry);
    if (target >= entry || sl <= entry) return null;
    return { side: "SHORT", entry, sl, target, ref: sl, note: hit.why };
  };
}

type PatternSignal2 = {
  side: PatternSide;
  entry: number;
  sl: number;
  target: number;
  ref: number;
  note: string;
};

// ---------- shape predicates ----------

/** Hammer / Hanging Man body: small body on top, long lower wick. */
function hammerShape(c: Candle): boolean {
  const r = rangeOf(c);
  if (r <= 0) return false;
  const body = bodyOf(c);
  return (
    body <= BODY_SMALL * r &&
    lowerWick(c) >= 2 * body &&
    lowerWick(c) >= WICK_MAIN * r &&
    upperWick(c) <= 0.35 * r
  );
}

/** Inverted Hammer / Shooting Star body: small body at the bottom, long upper wick. */
function starShape(c: Candle): boolean {
  const r = rangeOf(c);
  if (r <= 0) return false;
  const body = bodyOf(c);
  return (
    body <= BODY_SMALL * r &&
    upperWick(c) >= 2 * body &&
    upperWick(c) >= WICK_MAIN * r &&
    lowerWick(c) <= 0.35 * r
  );
}

function dojiShape(c: Candle): boolean {
  const r = rangeOf(c);
  return r > 0 && bodyOf(c) <= BODY_DOJI * r;
}

function dragonflyShape(c: Candle): boolean {
  const r = rangeOf(c);
  return r > 0 && bodyOf(c) <= BODY_DOJI * r && lowerWick(c) >= 0.65 * r && upperWick(c) <= WICK_OTHER * r;
}

function gravestoneShape(c: Candle): boolean {
  const r = rangeOf(c);
  return r > 0 && bodyOf(c) <= BODY_DOJI * r && upperWick(c) >= 0.65 * r && lowerWick(c) <= WICK_OTHER * r;
}

function bodyInside(inner: Candle, outer: Candle): boolean {
  const hi = Math.max(inner.o, inner.c);
  const lo = Math.min(inner.o, inner.c);
  return hi <= Math.max(outer.o, outer.c) && lo >= Math.min(outer.o, outer.c);
}

function bodyEngulfs(big: Candle, small: Candle): boolean {
  return (
    Math.max(big.o, big.c) >= Math.max(small.o, small.c) &&
    Math.min(big.o, big.c) <= Math.min(small.o, small.c) &&
    bodyOf(big) > bodyOf(small)
  );
}

// ---------- checks (i = last completed candle) ----------

const BULL_TREND_DESC = "after a down-move";

const CHECKS: Record<string, CsCheck> = {
  // ----- single candle -----
  HAMMER: (cs, i, x) =>
    trendOk(x, "DOWN") && hammerShape(cs[i])
      ? {
          side: "LONG",
          lows: [cs[i].l],
          highs: [cs[i].h],
          why: `Hammer: lower wick rejected ${fmt(cs[i].l)} ${BULL_TREND_DESC} — buyers took the close.`,
        }
      : null,
  INVERTED_HAMMER: (cs, i, x) =>
    trendOk(x, "DOWN") && starShape(cs[i])
      ? {
          side: "LONG",
          lows: [cs[i].l],
          highs: [cs[i].h],
          why: `Inverted hammer: probed ${fmt(cs[i].h)} ${BULL_TREND_DESC} — first push of demand.`,
        }
      : null,
  SHOOTING_STAR: (cs, i, x) =>
    trendOk(x, "UP") && starShape(cs[i])
      ? {
          side: "SHORT",
          lows: [cs[i].l],
          highs: [cs[i].h],
          why: `Shooting star: upper wick rejected ${fmt(cs[i].h)} after an up-move — supply hit the close.`,
        }
      : null,
  HANGING_MAN: (cs, i, x) =>
    trendOk(x, "UP") && hammerShape(cs[i])
      ? {
          side: "SHORT",
          lows: [cs[i].l],
          highs: [cs[i].h],
          why: `Hanging man: low of the bar lost ${fmt(cs[i].l)} after an up-move — selling pressure inside the candle.`,
        }
      : null,
  BULL_BELT_HOLD: (cs, i, x) => {
    const c = cs[i];
    const r = rangeOf(c);
    return trendOk(x, "DOWN") && isBull(c) && r > 0 && lowerWick(c) <= WICK_OTHER * r && upperWick(c) <= WICK_OTHER * r && bodyOf(c) >= x.long
      ? { side: "LONG", lows: [c.l], highs: [c.h], why: `Bullish belt hold: opened at the low ${fmt(c.l)} and closed at the high — strong buy day.` }
      : null;
  },
  BEAR_BELT_HOLD: (cs, i, x) => {
    const c = cs[i];
    const r = rangeOf(c);
    return trendOk(x, "UP") && isBear(c) && r > 0 && lowerWick(c) <= WICK_OTHER * r && upperWick(c) <= WICK_OTHER * r && bodyOf(c) >= x.long
      ? { side: "SHORT", lows: [c.l], highs: [c.h], why: `Bearish belt hold: opened at the high ${fmt(c.h)} and closed at the low — strong sell day.` }
      : null;
  },
  DRAGONFLY_DOJI: (cs, i, x) =>
    trendOk(x, "DOWN") && dragonflyShape(cs[i])
      ? { side: "LONG", lows: [cs[i].l], highs: [cs[i].h], why: `Dragonfly doji: open/high/close all near ${fmt(cs[i].h)} after a fall — demand absorbed the flush.` }
      : null,
  GRAVESTONE_DOJI: (cs, i, x) =>
    trendOk(x, "UP") && gravestoneShape(cs[i])
      ? { side: "SHORT", lows: [cs[i].l], highs: [cs[i].h], why: `Gravestone doji: open/low/close all near ${fmt(cs[i].l)} after a rise — supply absorbed the push.` }
      : null,

  // ----- two candle -----
  BULL_ENGULFING: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return trendOk(x, "DOWN") && isBear(p1) && isBull(c) && bodyEngulfs(c, p1) && bodyOf(c) >= x.long
      ? { side: "LONG", lows: [p1.l, c.l], highs: [c.h], why: `Bullish engulfing: body swallowed ${fmt(p1.o)}–${fmt(p1.c)} — buyers took control.` }
      : null;
  },
  BEAR_ENGULFING: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return trendOk(x, "UP") && isBull(p1) && isBear(c) && bodyEngulfs(c, p1) && bodyOf(c) >= x.long
      ? { side: "SHORT", lows: [c.l], highs: [p1.h, c.h], why: `Bearish engulfing: body swallowed ${fmt(p1.o)}–${fmt(p1.c)} — sellers took control.` }
      : null;
  },
  PIERCING_LINE: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(p1) &&
      bodyOf(p1) >= x.long &&
      isBull(c) &&
      c.o < p1.c &&
      c.c > midOf(p1) &&
      c.c < p1.o
    )
      ? { side: "LONG", lows: [p1.l, c.l], highs: [c.h], why: `Piercing line: closed ${fmt(c.c)} above the midpoint of the prior red candle — bullish reversal.` }
      : null;
  },
  DARK_CLOUD_COVER: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return (
      trendOk(x, "UP") &&
      isBull(p1) &&
      bodyOf(p1) >= x.long &&
      isBear(c) &&
      c.o > p1.c &&
      c.c < midOf(p1) &&
      c.c > p1.o
    )
      ? { side: "SHORT", lows: [c.l], highs: [p1.h, c.h], why: `Dark cloud cover: closed ${fmt(c.c)} below the midpoint of the prior green candle — bearish reversal.` }
      : null;
  },
  BULL_HARAMI: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(p1) &&
      bodyOf(p1) >= x.veryLong &&
      isBull(c) &&
      bodyInside(c, p1) &&
      bodyOf(c) <= 0.6 * bodyOf(p1)
    )
      ? { side: "LONG", lows: [p1.l, c.l], highs: [c.h], why: `Bullish harami: small green body inside the big red candle — selling pressure fading.` }
      : null;
  },
  BEAR_HARAMI: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return (
      trendOk(x, "UP") &&
      isBull(p1) &&
      bodyOf(p1) >= x.veryLong &&
      isBear(c) &&
      bodyInside(c, p1) &&
      bodyOf(c) <= 0.6 * bodyOf(p1)
    )
      ? { side: "SHORT", lows: [c.l], highs: [p1.h, c.h], why: `Bearish harami: small red body inside the big green candle — buying pressure fading.` }
      : null;
  },
  BULL_KICKER: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return trendOk(x, "DOWN") && isBear(p1) && isBull(c) && c.o > p1.c && c.c > p1.o
      ? { side: "LONG", lows: [p1.l, c.l], highs: [c.h], why: `Bullish kicker: gapped up from ${fmt(c.o)} over the red candle and never looked back — sentiment flip.` }
      : null;
  },
  BEAR_KICKER: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return trendOk(x, "UP") && isBull(p1) && isBear(c) && c.o < p1.c && c.c < p1.o
      ? { side: "SHORT", lows: [c.l], highs: [p1.h, c.h], why: `Bearish kicker: gapped down from ${fmt(c.o)} under the green candle and kept going — sentiment flip.` }
      : null;
  },
  TWEEZER_BOTTOM: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return trendOk(x, "DOWN") && isBear(p1) && isBull(c) && Math.abs(c.l - p1.l) <= 0.1 * x.a
      ? { side: "LONG", lows: [Math.min(p1.l, c.l)], highs: [c.h], why: `Tweezer bottom: matching lows ${fmt(c.l)} — support confirmed twice.` }
      : null;
  },
  TWEEZER_TOP: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return trendOk(x, "UP") && isBull(p1) && isBear(c) && Math.abs(c.h - p1.h) <= 0.1 * x.a
      ? { side: "SHORT", lows: [c.l], highs: [Math.max(p1.h, c.h)], why: `Tweezer top: matching highs ${fmt(c.h)} — resistance confirmed twice.` }
      : null;
  },
  BULL_SEPARATING_LINES: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return trendOk(x, "UP") && isBear(p1) && isBull(c) && Math.abs(c.o - p1.o) <= 0.1 * x.a && c.c > p1.h
      ? { side: "LONG", lows: [c.l], highs: [c.h], why: `Bullish separating lines: same open ${fmt(c.o)}, green candle resumed the uptrend.` }
      : null;
  },
  MEETING_LINES_BULL: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return (
      trendOk(x, "DOWN") && isBear(p1) && bodyOf(p1) >= x.long && isBull(c) && bodyOf(c) >= x.long && c.o < p1.c && Math.abs(c.c - p1.c) <= 0.1 * x.a
    )
      ? { side: "LONG", lows: [p1.l, c.l], highs: [c.h], why: `Meeting lines: green candle rallied back to close at ${fmt(c.c)}, matching the red close — shift to demand.` }
      : null;
  },
  MEETING_LINES_BEAR: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return (
      trendOk(x, "UP") && isBull(p1) && bodyOf(p1) >= x.long && isBear(c) && bodyOf(c) >= x.long && c.o > p1.c && Math.abs(c.c - p1.c) <= 0.1 * x.a
    )
      ? { side: "SHORT", lows: [c.l], highs: [p1.h, c.h], why: `Meeting lines: red candle sank to close at ${fmt(c.c)}, matching the green close — shift to supply.` }
      : null;
  },
  BEAR_DOJI_STAR: (cs, i, x) => {
    const p1 = cs[i - 1];
    const c = cs[i];
    return trendOk(x, "UP") && isBull(p1) && bodyOf(p1) >= x.long && dojiShape(c) && c.o > p1.c
      ? { side: "SHORT", lows: [c.l], highs: [c.h], why: `Bearish doji star: indecision gapped up at ${fmt(c.o)} after the rally — momentum stalling.` }
      : null;
  },
  UPSIDE_GAP_TWO_CROWS: (cs, i, x) => {
    const p1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "UP") &&
      isBull(p1) &&
      bodyOf(p1) >= x.long &&
      isBear(c2) &&
      c2.o > p1.c &&
      isBear(c3) &&
      c3.o > c2.o &&
      c3.c < c2.c &&
      c3.c > p1.c
    )
      ? { side: "SHORT", lows: [c3.l], highs: [Math.max(p1.h, c2.h, c3.h)], why: `Upside gap two crows: two red candles failed above ${fmt(p1.c)} — trapped buyers above.` }
      : null;
  },

  // ----- three candle -----
  MORNING_STAR: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      bodyOf(c1) >= x.veryLong &&
      bodyOf(c2) <= 0.45 * bodyOf(c1) &&
      Math.max(c2.o, c2.c) <= midOf(c1) &&
      isBull(c3) &&
      c3.c > midOf(c1)
    )
      ? { side: "LONG", lows: [c1.l, c2.l, c3.l], highs: [c3.h], why: `Morning star: flush ${fmt(c1.c)} → stall → reclaim ${fmt(c3.c)} — classic bottom reversal.` }
      : null;
  },
  EVENING_STAR: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "UP") &&
      isBull(c1) &&
      bodyOf(c1) >= x.veryLong &&
      bodyOf(c2) <= 0.45 * bodyOf(c1) &&
      Math.min(c2.o, c2.c) >= midOf(c1) &&
      isBear(c3) &&
      c3.c < midOf(c1)
    )
      ? { side: "SHORT", lows: [c3.l], highs: [c1.h, c2.h, c3.h], why: `Evening star: rally ${fmt(c1.c)} → stall → loss of ${fmt(c3.c)} — classic top reversal.` }
      : null;
  },
  BULL_ABANDONED_BABY: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      dojiShape(c2) &&
      c2.h < c1.l &&
      isBull(c3) &&
      c3.l > c2.h &&
      c3.c > midOf(c1)
    )
      ? { side: "LONG", lows: [c2.l, c3.l], highs: [c3.h], why: `Bullish abandoned baby: doji orphaned below ${fmt(c1.l)}–${fmt(c3.l)} gaps — capitulation and snap-back.` }
      : null;
  },
  BEAR_ABANDONED_BABY: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "UP") &&
      isBull(c1) &&
      dojiShape(c2) &&
      c2.l > c1.h &&
      isBear(c3) &&
      c3.h < c2.l &&
      c3.c < midOf(c1)
    )
      ? { side: "SHORT", lows: [c3.l], highs: [c2.h], why: `Bearish abandoned baby: doji orphaned above ${fmt(c1.h)}–${fmt(c3.h)} gaps — blow-off and collapse.` }
      : null;
  },
  THREE_INSIDE_UP: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      bodyOf(c1) >= x.veryLong &&
      isBull(c2) &&
      bodyInside(c2, c1) &&
      isBull(c3) &&
      c3.c > c1.o
    )
      ? { side: "LONG", lows: [c1.l, c2.l, c3.l], highs: [c3.h], why: `Three inside up: harami confirmed by close ${fmt(c3.c)} over the red candle's open — reversal confirmed.` }
      : null;
  },
  BEAR_THREE_INSIDE_DOWN: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "UP") &&
      isBull(c1) &&
      bodyOf(c1) >= x.veryLong &&
      isBear(c2) &&
      bodyInside(c2, c1) &&
      isBear(c3) &&
      c3.c < c1.o
    )
      ? { side: "SHORT", lows: [c3.l], highs: [c1.h, c2.h, c3.h], why: `Three inside down: harami confirmed by close ${fmt(c3.c)} under the green candle's open — reversal confirmed.` }
      : null;
  },
  THREE_OUTSIDE_UP: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      isBull(c2) &&
      bodyEngulfs(c2, c1) &&
      isBull(c3) &&
      c3.c > c2.c
    )
      ? { side: "LONG", lows: [c1.l, c2.l, c3.l], highs: [c3.h], why: `Three outside up: engulfing bull candle plus follow-through ${fmt(c3.c)} — reversal confirmed.` }
      : null;
  },
  BEAR_THREE_OUTSIDE_DOWN: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    return (
      trendOk(x, "UP") &&
      isBull(c1) &&
      isBear(c2) &&
      bodyEngulfs(c2, c1) &&
      isBear(c3) &&
      c3.c < c2.c
    )
      ? { side: "SHORT", lows: [c3.l], highs: [c1.h, c2.h, c3.h], why: `Three outside down: engulfing bear candle plus follow-through ${fmt(c3.c)} — reversal confirmed.` }
      : null;
  },
  THREE_WHITE_SOLDIERS: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    const soldier = (c: Candle, prev: Candle | null) =>
      isBull(c) &&
      bodyOf(c) >= x.long &&
      upperWick(c) <= 0.3 * bodyOf(c) &&
      (prev === null || (c.o >= Math.min(prev.o, prev.c) && c.o <= Math.max(prev.o, prev.c)) || c.o > prev.c) &&
      (prev === null || c.c > prev.c);
    return trendOk(x, "DOWN") && soldier(c1, null) && soldier(c2, c1) && soldier(c3, c2)
      ? { side: "LONG", lows: [c1.l, c2.l, c3.l], highs: [c3.h], why: `Three white soldiers: three strong green bodies marching up from ${fmt(c1.o)} — steady demand.` }
      : null;
  },
  THREE_BLACK_CROWS: (cs, i, x) => {
    const c1 = cs[i - 2];
    const c2 = cs[i - 1];
    const c3 = cs[i];
    const crow = (c: Candle, prev: Candle | null) =>
      isBear(c) &&
      bodyOf(c) >= x.long &&
      lowerWick(c) <= 0.3 * bodyOf(c) &&
      (prev === null || (c.o >= Math.min(prev.o, prev.c) && c.o <= Math.max(prev.o, prev.c)) || c.o < prev.c) &&
      (prev === null || c.c < prev.c);
    return trendOk(x, "UP") && crow(c1, null) && crow(c2, c1) && crow(c3, c2)
      ? { side: "SHORT", lows: [c3.l], highs: [c1.h, c2.h, c3.h], why: `Three black crows: three strong red bodies marching down from ${fmt(c1.o)} — steady supply.` }
      : null;
  },

  // ----- four / five candle -----
  RISING_THREE_METHODS: (cs, i, x) => {
    const c1 = cs[i - 4];
    const c5 = cs[i];
    const mids = [cs[i - 3], cs[i - 2], cs[i - 1]];
    return (
      trendOk(x, "UP") &&
      isBull(c1) &&
      bodyOf(c1) >= x.veryLong &&
      mids.every((m) => bodyOf(m) <= 0.45 * bodyOf(c1) && m.h <= c1.h && m.l >= c1.l) &&
      isBull(c5) &&
      c5.c > c1.h
    )
      ? { side: "LONG", lows: [c1.l, ...mids.map((m) => m.l), c5.l], highs: [c5.h], why: `Rising three methods: three quiet bars rested inside the green candle, then ${fmt(c5.c)} broke its high — uptrend continues.` }
      : null;
  },
  FALLING_THREE_METHODS: (cs, i, x) => {
    const c1 = cs[i - 4];
    const c5 = cs[i];
    const mids = [cs[i - 3], cs[i - 2], cs[i - 1]];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      bodyOf(c1) >= x.veryLong &&
      mids.every((m) => bodyOf(m) <= 0.45 * bodyOf(c1) && m.h <= c1.h && m.l >= c1.l) &&
      isBear(c5) &&
      c5.c < c1.l
    )
      ? { side: "SHORT", lows: [c5.l], highs: [c1.h, ...mids.map((m) => m.h), c5.h], why: `Falling three methods: three quiet bars rested inside the red candle, then ${fmt(c5.c)} broke its low — downtrend continues.` }
      : null;
  },
  BULL_MAT_HOLD: (cs, i, x) => {
    const c1 = cs[i - 4];
    const c5 = cs[i];
    const mids = [cs[i - 3], cs[i - 2], cs[i - 1]];
    return (
      trendOk(x, "UP") &&
      isBull(c1) &&
      bodyOf(c1) >= x.veryLong &&
      mids.every((m) => bodyOf(m) <= 0.45 * bodyOf(c1) && m.l >= c1.l && m.h <= c1.h + 0.2 * bodyOf(c1)) &&
      isBull(c5) &&
      c5.c > c1.h
    )
      ? { side: "LONG", lows: [c1.l, ...mids.map((m) => m.l), c5.l], highs: [c5.h], why: `Bull mat hold: pullback held above ${fmt(c1.l)} and the push resumed over ${fmt(c1.h)} — uptrend continues.` }
      : null;
  },
  BEAR_MAT_HOLD: (cs, i, x) => {
    const c1 = cs[i - 4];
    const c5 = cs[i];
    const mids = [cs[i - 3], cs[i - 2], cs[i - 1]];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      bodyOf(c1) >= x.veryLong &&
      mids.every((m) => bodyOf(m) <= 0.45 * bodyOf(c1) && m.h <= c1.h && m.l >= c1.l - 0.2 * bodyOf(c1)) &&
      isBear(c5) &&
      c5.c < c1.l
    )
      ? { side: "SHORT", lows: [c5.l], highs: [c1.h, ...mids.map((m) => m.h), c5.h], why: `Bear mat hold: bounce held under ${fmt(c1.h)} and the slide resumed under ${fmt(c1.l)} — downtrend continues.` }
      : null;
  },
  BULL_THREE_LINE_STRIKE: (cs, i, x) => {
    const c1 = cs[i - 3];
    const c2 = cs[i - 2];
    const c3 = cs[i - 1];
    const c4 = cs[i];
    return (
      trendOk(x, "UP") &&
      isBull(c1) &&
      isBull(c2) &&
      isBull(c3) &&
      bodyOf(c1) >= x.long &&
      c2.c > c1.c &&
      c3.c > c2.c &&
      isBear(c4) &&
      bodyOf(c4) >= x.veryLong &&
      c4.c < c1.o
    )
      ? { side: "LONG", lows: [c4.l], highs: [c4.h], why: `Bullish three-line strike: one red candle erased the three green closes down to ${fmt(c4.c)} — bear trap, uptrend resumes.` }
      : null;
  },
  BEAR_THREE_LINE_STRIKE: (cs, i, x) => {
    const c1 = cs[i - 3];
    const c2 = cs[i - 2];
    const c3 = cs[i - 1];
    const c4 = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      isBear(c2) &&
      isBear(c3) &&
      bodyOf(c1) >= x.long &&
      c2.c < c1.c &&
      c3.c < c2.c &&
      isBull(c4) &&
      bodyOf(c4) >= x.veryLong &&
      c4.c > c1.o
    )
      ? { side: "SHORT", lows: [c4.l], highs: [c4.h], why: `Bearish three-line strike: one green candle erased the three red closes up to ${fmt(c4.c)} — bull trap, downtrend resumes.` }
      : null;
  },
  CONCEALING_BABY_SWALLOW: (cs, i, x) => {
    const c1 = cs[i - 3];
    const c2 = cs[i - 2];
    const c3 = cs[i - 1];
    const c4 = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      bodyOf(c1) >= x.long &&
      isBear(c2) &&
      bodyOf(c2) >= x.long &&
      c2.c < c1.c &&
      c3.h < c2.c &&
      isBear(c4) &&
      c4.o >= c3.c &&
      c4.c < c3.l
    )
      ? { side: "LONG", lows: [c4.l], highs: [c4.h], why: `Concealing baby swallow: gap-down marubozu completed the flush ${fmt(c4.l)} — final capitulation, reversal watch.` }
      : null;
  },
  LADDER_BOTTOM: (cs, i, x) => {
    const c1 = cs[i - 4];
    const c2 = cs[i - 3];
    const c3 = cs[i - 2];
    const c4 = cs[i - 1];
    const c5 = cs[i];
    return (
      trendOk(x, "DOWN") &&
      isBear(c1) &&
      bodyOf(c1) >= x.long &&
      isBear(c2) &&
      bodyOf(c2) >= x.long &&
      c2.c < c1.c &&
      isBear(c3) &&
      bodyOf(c3) >= x.long &&
      c3.c < c2.c &&
      bodyOf(c4) <= 0.5 * x.bodyAvg &&
      isBull(c5) &&
      bodyOf(c5) >= x.long &&
      c5.c > Math.max(c3.c, c4.h)
    )
      ? { side: "LONG", lows: [c4.l, c5.l], highs: [c5.h], why: `Ladder bottom: three red steps, a stall at ${fmt(c4.l)}, then a strong green candle — base complete.` }
      : null;
  },
};

export const CANDLESTICK_DEFS: PatternDef[] = (
  [
    ["HAMMER", "Hammer", "Wick reject low", "Small body, long lower wick after a decline — buyers rejected the lows (Groww)."],
    ["INVERTED_HAMMER", "Inverted Hammer", "Probe up in decline", "Small body, long upper wick after a decline — first sign of demand (Groww)."],
    ["BULL_ENGULFING", "Bullish Engulfing", "Green swallows red", "Large green body engulfs the prior red body — buyers overwhelmed sellers (Groww)."],
    ["MORNING_STAR", "Morning Star", "Flush-stall-reclaim", "Long red, small-bodied pause, then a green candle back into the red body — bottom reversal (Groww)."],
    ["PIERCING_LINE", "Piercing Line", "Close over midpoint", "Green candle opens below the prior close and closes above its midpoint — bullish reversal (Groww)."],
    ["BULL_HARAMI", "Bullish Harami", "Inside pause", "Small green body inside a long red body — selling pressure fading (Groww)."],
    ["THREE_WHITE_SOLDIERS", "Three White Soldiers", "3 strong greens", "Three long green candles with small wicks marching up — downtrend to uptrend (Groww)."],
    ["DRAGONFLY_DOJI", "Dragonfly Doji", "Open=high=close", "Doji with a long lower wick after a fall — demand absorbed the flush (Groww)."],
    ["BULL_ABANDONED_BABY", "Bullish Abandoned Baby", "Orphan doji low", "Doji gapped below the red candle and below the green candle — strong reversal (Groww)."],
    ["THREE_INSIDE_UP", "Three Inside Up", "Harami confirmed", "Harami then a green close above the red candle's open — reversal confirmed (Groww)."],
    ["THREE_OUTSIDE_UP", "Three Outside Up", "Engulf + follow", "Engulfing bull candle plus a higher green close — reversal confirmed (Groww)."],
    ["BULL_KICKER", "Bullish Kicker", "Gap-and-go up", "Green candle gaps above the red candle's close and extends — sentiment flip (Groww)."],
    ["TWEEZER_BOTTOM", "Tweezer Bottom", "Twin lows", "Red then green candle with matching lows — support found twice (Groww)."],
    ["RISING_THREE_METHODS", "Rising Three Methods", "Rest then continue", "Three small candles rest inside a big green candle, then green breaks its high — uptrend continues (Groww)."],
    ["CONCEALING_BABY_SWALLOW", "Concealing Baby Swallow", "Final flush", "Two red marubozu, a gap-down candle, then a red marubozu swallowing it — last capitulation (Groww)."],
    ["BULL_MAT_HOLD", "Bull Mat Hold", "Shallow pause", "Pullback holds within the green candle's range, then breaks its high — uptrend continues (Groww)."],
    ["BULL_SEPARATING_LINES", "Bullish Separating Lines", "Same open, green", "Green candle opens at the red candle's open and resumes the uptrend (Groww)."],
    ["BULL_BELT_HOLD", "Bullish Belt Hold", "Open at low", "Opens at the low, closes near the high with no lower wick — strong buy day (Groww)."],
    ["BULL_THREE_LINE_STRIKE", "Bullish Three-Line Strike", "Bear trap erase", "One red candle erases three green closes — pullback, uptrend resumes (Groww)."],
    ["LADDER_BOTTOM", "Ladder Bottom", "Steps then stall", "Three red candles, a small stall, then a strong green candle — downtrend ending (Groww)."],
    ["MEETING_LINES_BULL", "Meeting Lines (Bull)", "Close meets close", "Long green candle closes at the prior red close after a downtrend — demand shift (Groww)."],
    ["SHOOTING_STAR", "Shooting Star", "Wick reject high", "Small body, long upper wick after a rally — sellers rejected the highs (Groww)."],
    ["HANGING_MAN", "Hanging Man", "Weak low after rally", "Hammer shape at the top of an uptrend — selling pressure inside the candle (Groww)."],
    ["BEAR_ENGULFING", "Bearish Engulfing", "Red swallows green", "Large red body engulfs the prior green body — sellers overwhelmed buyers (Groww)."],
    ["EVENING_STAR", "Evening Star", "Rally-stall-drop", "Long green, small-bodied pause, then a red candle back into the green body — top reversal (Groww)."],
    ["DARK_CLOUD_COVER", "Dark Cloud Cover", "Close under midpoint", "Red candle opens above the prior close and closes below its midpoint — bearish reversal (Groww)."],
    ["BEAR_HARAMI", "Bearish Harami", "Inside pause", "Small red body inside a long green body — buying pressure fading (Groww)."],
    ["THREE_BLACK_CROWS", "Three Black Crows", "3 strong reds", "Three long red candles with small wicks marching down — uptrend to downtrend (Groww)."],
    ["GRAVESTONE_DOJI", "Gravestone Doji", "Open=low=close", "Doji with a long upper wick after a rise — supply absorbed the push (mirror of Groww's dragonfly)."],
    ["BEAR_ABANDONED_BABY", "Bearish Abandoned Baby", "Orphan doji high", "Doji gapped above the green candle and below the red candle — sharp reversal (Groww)."],
    ["BEAR_THREE_INSIDE_DOWN", "Three Inside Down", "Harami confirmed", "Harami then a red close below the green candle's open — reversal confirmed (Groww)."],
    ["BEAR_THREE_OUTSIDE_DOWN", "Three Outside Down", "Engulf + follow", "Engulfing bear candle plus a lower red close — reversal confirmed (Groww)."],
    ["BEAR_KICKER", "Bearish Kicker", "Gap-and-go down", "Red candle gaps below the green candle's close and extends — sentiment flip (Groww)."],
    ["TWEEZER_TOP", "Tweezer Top", "Twin highs", "Green then red candle with matching highs — resistance found twice (Groww)."],
    ["FALLING_THREE_METHODS", "Falling Three Methods", "Rest then continue", "Three small candles rest inside a big red candle, then red breaks its low — downtrend continues (Groww)."],
    ["UPSIDE_GAP_TWO_CROWS", "Upside Gap Two Crows", "Trapped above gap", "Two red candles fail above the gap after a rally — reversal forming (Groww)."],
    ["BEAR_DOJI_STAR", "Bearish Doji Star", "Doji gaps up", "Doji gaps up after a long green candle — momentum stalling (Groww)."],
    ["BEAR_MAT_HOLD", "Bear Mat Hold", "Shallow bounce", "Bounce holds within the red candle's range, then breaks its low — downtrend continues (Groww)."],
    ["BEAR_BELT_HOLD", "Bearish Belt Hold", "Open at high", "Opens at the high, closes near the low with no upper wick — strong sell day (Groww)."],
    ["BEAR_THREE_LINE_STRIKE", "Bearish Three-Line Strike", "Bull trap erase", "One green candle erases three red closes — bounce, downtrend resumes (Groww)."],
    ["MEETING_LINES_BEAR", "Meeting Lines (Bear)", "Close meets close", "Long red candle closes at the prior green close after an uptrend — supply shift (companion to Groww's bullish version)."],
  ] as Array<[string, string, string, string]>
).map(([id, label, short, desc]) => ({
  id: id as PatternDef["id"],
  category: "CANDLESTICK" as const,
  label,
  short,
  desc,
  params: csParams(),
}));

export const CANDLESTICK_DETECTORS: Partial<Record<string, Detector>> = Object.fromEntries(
  CANDLESTICK_DEFS.map((d) => [d.id, makeCs(d.id, CHECKS[d.id])]),
);
