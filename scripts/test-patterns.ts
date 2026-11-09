// Pattern detector test suite.
// Run: bun scripts/test-patterns.ts
//
// Part 1 — registry integrity (every def has a detector, ids unique).
// Part 2 — hand-crafted candle series for one representative of each
//          pattern family, asserting the expected signal + side.
// Part 3 — smoke run: every detector over seeded random walks (no exceptions,
//          sane levels: SL on the right side of entry, target beyond SL).

import {
  PATTERN_DEFS,
  PATTERN_MAP,
  runPatternDetectors,
  validStrategyIds,
  type Candle,
  type PatternId,
} from "../src/lib/patterns";

let t = 1_700_000_000_000;
function bar(o: number, h: number, l: number, c: number): Candle {
  t += 60_000;
  return { t, o, h, l, c };
}
function padTo(cs: Candle[], count: number, price: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) out.push({ t: (t += 60_000), o: price, h: price + 0.01, l: price - 0.01, c: price });
  return [...out, ...cs];
}
function runOne(id: PatternId, cs: Candle[]) {
  return runPatternDetectors(cs, [id], {})[0] ?? null;
}

let pass = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------- part 1: registry ----------

console.log("registry");
{
  const ids = new Set(PATTERN_DEFS.map((p) => p.id));
  check("unique ids", ids.size === PATTERN_DEFS.length, `${ids.size} vs ${PATTERN_DEFS.length}`);
  check("pattern count is 69 (38 Groww + 3 mirrors + 23 chart + 5 price action)", PATTERN_DEFS.length === 69, `got ${PATTERN_DEFS.length}`);
  check("validStrategyIds covers all", PATTERN_DEFS.every((p) => validStrategyIds().includes(p.id)));
  check("every def has non-empty params", PATTERN_DEFS.every((p) => p.params.length > 0));
  check("every def has category", PATTERN_DEFS.every((p) => ["PRICE_ACTION", "CHART", "CANDLESTICK"].includes(p.category)));
  const cats = new Map<string, number>();
  for (const p of PATTERN_DEFS) cats.set(p.category, (cats.get(p.category) ?? 0) + 1);
  console.log(`   categories:`, Object.fromEntries(cats));
  check("PATTERN_MAP resolves", PATTERN_MAP["HAMMER"]?.label === "Hammer");
}

// ---------- part 2: crafted setups ----------

console.log("candlestick (Groww catalog)");
{
  // Hammer: 20 flat + 18 declining + hammer
  const cs: Candle[] = [];
  for (let i = 0; i < 18; i++) {
    const o = 110 - i * 0.6;
    cs.push(bar(o, o + 0.1, o - 0.6, o - 0.5));
  }
  cs.push(bar(100, 100.3, 97.5, 100.2)); // hammer
  const sig = runOne("HAMMER", padTo(cs, 20, 110));
  check("HAMMER fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Bullish engulfing
  const cs: Candle[] = [];
  for (let i = 0; i < 15; i++) {
    const o = 106 - i * 0.4;
    cs.push(bar(o, o + 0.08, o - 0.45, o - 0.35));
  }
  cs.push(bar(101, 101.2, 99.8, 100)); // small red
  cs.push(bar(99.9, 101.7, 99.5, 101.5)); // big green engulf
  const sig = runOne("BULL_ENGULFING", padTo(cs, 20, 106));
  check("BULL_ENGULFING fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Morning star
  const cs: Candle[] = [];
  for (let i = 0; i < 15; i++) {
    const o = 108 - i * 0.5;
    cs.push(bar(o, o + 0.1, o - 0.55, o - 0.45));
  }
  cs.push(bar(101, 101.1, 98.4, 98.5)); // long red (body 2.5)
  cs.push(bar(98.3, 98.5, 97.9, 98.1)); // small stall below midpoint
  cs.push(bar(98.2, 100.7, 98.0, 100.5)); // green reclaim over midpoint
  const sig = runOne("MORNING_STAR", padTo(cs, 20, 108));
  check("MORNING_STAR fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Piercing line
  const cs: Candle[] = [];
  for (let i = 0; i < 15; i++) {
    const o = 107 - i * 0.4;
    cs.push(bar(o, o + 0.08, o - 0.45, o - 0.35));
  }
  cs.push(bar(103, 103.1, 100.8, 101)); // long red
  cs.push(bar(100.8, 102.5, 100.5, 102.3)); // green closes over midpoint (102) under open (103)
  const sig = runOne("PIERCING_LINE", padTo(cs, 20, 107));
  check("PIERCING_LINE fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Tweezer bottom
  const cs: Candle[] = [];
  for (let i = 0; i < 15; i++) {
    const o = 105 - i * 0.4;
    cs.push(bar(o, o + 0.08, o - 0.45, o - 0.35));
  }
  cs.push(bar(101, 101.2, 99.8, 100));
  cs.push(bar(100.2, 101.5, 99.82, 101.3));
  const sig = runOne("TWEEZER_BOTTOM", padTo(cs, 20, 105));
  check("TWEEZER_BOTTOM fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

console.log("chart patterns (NCFE / Fidelity)");
{
  // Ascending triangle: flat top 100.6, rising lows, breakout
  const cs: Candle[] = [
    bar(98.9, 99.1, 98.5, 98.6),
    bar(98.6, 98.9, 98.2, 98.4),
    bar(98.5, 100.6, 98.4, 100.2), // peak 1
    bar(100.1, 100.3, 99.0, 99.2),
    bar(99.2, 99.4, 98.8, 99.0),
    bar(99.0, 99.2, 97.6, 98.8), // low 1
    bar(98.8, 99.6, 98.7, 99.4),
    bar(99.4, 99.8, 99.2, 99.6),
    bar(99.6, 100.6, 99.5, 100.3), // peak 2 (flat top)
    bar(100.2, 100.4, 99.6, 99.8),
    bar(99.8, 100.0, 99.4, 99.6),
    bar(99.6, 99.8, 99.0, 99.4), // low 2 (rising)
    bar(99.6, 100.1, 99.4, 99.8),
    bar(99.8, 100.2, 99.5, 100.0),
    bar(100.0, 100.35, 99.7, 99.9),
    bar(100.0, 101.2, 99.9, 101.0), // breakout
  ];
  const sig = runOne("ASCENDING_TRIANGLE", padTo(cs, 20, 98.9));
  check("ASCENDING_TRIANGLE fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Symmetrical triangle: falling highs, rising lows, breakout before apex
  const cs: Candle[] = [
    bar(98.9, 99.1, 98.5, 98.6),
    bar(98.6, 98.9, 98.2, 98.4),
    bar(98.5, 100.6, 98.4, 100.2), // H1
    bar(100.1, 100.3, 99.0, 99.2),
    bar(99.2, 99.4, 98.8, 99.0),
    bar(99.0, 99.2, 98.4, 98.6),
    bar(98.6, 98.8, 97.8, 98.2), // L1
    bar(98.2, 99.2, 98.1, 99.0),
    bar(99.0, 99.8, 98.9, 99.6),
    bar(99.6, 100.0, 99.5, 99.8),
    bar(99.8, 100.1, 99.7, 100.0),
    bar(100.0, 100.15, 99.6, 99.8),
    bar(99.8, 100.2, 99.6, 99.9), // H2 (lower high)
    bar(99.9, 100.05, 99.4, 99.6),
    bar(99.6, 99.9, 99.2, 99.4),
    bar(99.4, 99.7, 99.0, 99.5),
    bar(99.5, 99.8, 98.8, 99.2), // L2 (higher low)
    bar(99.2, 99.6, 99.1, 99.4),
    bar(99.4, 99.8, 99.3, 99.7),
    bar(99.7, 100.0, 99.5, 99.8),
    bar(99.8, 99.9, 99.4, 99.7),
    bar(99.8, 100.7, 99.7, 100.5), // breakout
  ];
  const sig = runOne("SYMMETRICAL_TRIANGLE", padTo(cs, 20, 98.9));
  check("SYMMETRICAL_TRIANGLE fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Falling wedge: both boundaries falling, converging, upside break
  const cs: Candle[] = [
    bar(101.4, 101.8, 101.0, 101.3),
    bar(101.3, 102.0, 101.2, 101.8),
    bar(102.0, 103.0, 102.0, 102.6), // H1
    bar(102.4, 102.6, 99.6, 99.9),
    bar(99.9, 100.1, 99.3, 99.5),
    bar(99.5, 99.7, 99.0, 99.2), // L1
    bar(99.2, 99.8, 99.1, 99.6),
    bar(99.6, 100.2, 99.4, 100.0),
    bar(100.0, 101.0, 99.9, 100.7), // H2 (lower)
    bar(100.6, 100.8, 99.6, 99.8),
    bar(99.8, 100.0, 98.6, 98.8),
    bar(98.7, 98.9, 98.2, 98.5), // L2 (higher)
    bar(98.9, 99.2, 98.4, 98.6),
    bar(98.6, 99.0, 98.3, 98.4),
    bar(98.4, 98.8, 98.0, 98.5),
    bar(98.4, 99.6, 98.3, 99.3), // upside breakout
  ];
  const sig = runOne("FALLING_WEDGE", padTo(cs, 20, 101.4));
  check("FALLING_WEDGE fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Triple top: three equal highs ~100.6, neckline 98.4, breakdown
  const cs: Candle[] = [
    bar(99.4, 99.6, 99.0, 99.2),
    bar(99.2, 99.5, 98.9, 99.3),
    bar(99.3, 100.6, 99.2, 100.3), // peak 1
    bar(100.2, 100.4, 99.4, 99.6),
    bar(99.6, 99.8, 98.8, 99.0),
    bar(99.0, 99.2, 98.4, 98.8), // trough 1
    bar(98.8, 99.6, 98.7, 99.3),
    bar(99.3, 99.9, 99.1, 99.6),
    bar(99.6, 100.7, 99.5, 100.4), // peak 2
    bar(100.3, 100.5, 99.6, 99.8),
    bar(99.8, 100.0, 99.0, 99.2),
    bar(99.2, 99.4, 98.5, 98.9), // trough 2
    bar(98.9, 99.7, 98.8, 99.4),
    bar(99.4, 100.0, 99.2, 99.7),
    bar(99.7, 100.55, 99.6, 100.2), // peak 3
    bar(100.1, 100.3, 99.4, 99.6),
    bar(99.6, 99.8, 98.6, 98.7),
    bar(98.7, 98.9, 98.2, 98.4), // confirmation bar after the third peak
    bar(98.4, 98.5, 97.7, 97.9), // breakdown
  ];
  const sig = runOne("TRIPLE_TOP", padTo(cs, 20, 99.4));
  check("TRIPLE_TOP fires SHORT", sig?.side === "SHORT", JSON.stringify(sig));
}

{
  // Bull flag: pole 100→105, 8-bar shallow drift, breakout
  const cs: Candle[] = [
    bar(100.0, 100.4, 99.8, 100.2),
    bar(100.2, 101.0, 100.1, 100.8),
    bar(100.8, 101.8, 100.7, 101.6),
    bar(101.6, 102.6, 101.5, 102.4),
    bar(102.4, 103.5, 102.3, 103.3),
    bar(103.3, 105.0, 103.2, 104.8), // pole tip
    bar(104.8, 104.9, 103.8, 104.0),
    bar(104.0, 104.6, 103.6, 104.2),
    bar(104.2, 104.5, 103.4, 103.6),
    bar(103.6, 104.4, 103.5, 104.1),
    bar(104.1, 104.3, 103.2, 103.4),
    bar(103.4, 104.2, 103.3, 103.9),
    bar(103.9, 104.1, 103.0, 103.2),
    bar(103.2, 104.0, 102.6, 102.8),
    bar(102.9, 105.4, 102.8, 105.2), // breakout
  ];
  const sig = runOne("BULL_FLAG", padTo(cs, 20, 100));
  check("BULL_FLAG fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Cup & handle: programmatic 80-bar series
  const cs: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < 80; i++) {
    let mid: number;
    if (i <= 11) mid = 100 + i * (2.5 / 11);
    else if (i <= 47) mid = 102.55 - 10.15 * Math.sin((Math.PI * (i - 12)) / 35) - Math.max(0, i - 40) * 0.08;
    else if (i <= 77) mid = 101.4 - (i - 48) * 0.07;
    else if (i === 78) mid = 100.4;
    else mid = 102.0; // breakout close handled below
    const o = prev;
    const c = i === 79 ? 102.9 : mid;
    cs.push(bar(o, Math.max(o, c) + 0.06, Math.min(o, c) - 0.06, c));
    prev = c;
  }
  const sig = runOne("CUP_HANDLE", cs);
  check("CUP_HANDLE fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Key reversal: run up, new high, lower close
  const cs: Candle[] = [];
  let prevC = 100;
  for (let i = 0; i < 14; i++) {
    const c = 100 + (i + 1) * 0.15;
    cs.push(bar(prevC, c + 0.08, prevC - 0.08, c));
    prevC = c;
  }
  const last = cs[cs.length - 1];
  cs.push(bar(last.c, last.h + 0.35, last.c - 0.25, last.c - 0.2));
  const sig = runOne("KEY_REVERSAL", padTo(cs, 20, 100));
  check("KEY_REVERSAL fires SHORT", sig?.side === "SHORT", JSON.stringify(sig));
}

{
  // Inside bar breakout: zigzag warmup, wide mother, inside bar, break up
  const cs: Candle[] = [];
  for (let i = 0; i < 18; i++) {
    const up = i % 2 === 0;
    const o = up ? 99.4 : 100.6;
    const c = up ? 100.6 : 99.4;
    cs.push(bar(o, Math.max(o, c) + 0.15, Math.min(o, c) - 0.15, c));
  }
  cs.push(bar(100.0, 101.3, 99.0, 101.0)); // mother (range 2.3)
  cs.push(bar(100.6, 101.1, 99.4, 100.2)); // inside
  cs.push(bar(100.3, 101.9, 100.2, 101.6)); // break above inside high
  const sig = runOne("INSIDE_BAR_BREAKOUT", padTo(cs, 20, 100));
  check("INSIDE_BAR_BREAKOUT fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

{
  // Breakaway gap: tight base then gap up and hold
  const cs: Candle[] = [];
  for (let i = 0; i < 34; i++) {
    const c = 100 + (i % 2 === 0 ? 0.12 : -0.12);
    cs.push(bar(100.12, 100.3, 99.7, c));
  }
  const last = cs[cs.length - 1];
  cs.push(bar(last.h + 0.5, last.h + 0.9, last.h + 0.2, last.h + 0.8));
  const sig = runOne("BREAKAWAY_GAP", padTo(cs, 20, 100.12));
  check("BREAKAWAY_GAP fires LONG", sig?.side === "LONG", JSON.stringify(sig));
}

// ---------- part 3: smoke ----------

console.log("smoke: all detectors on seeded random walks");
{
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 14), 0)) >>> 0;
      return t / 4294967296;
    };
  }
  const allIds = PATTERN_DEFS.map((p) => p.id);
  let fired = 0;
  let evals = 0;
  let levelErrors = 0;
  for (const seed of [11, 42, 777]) {
    const rand = mulberry32(seed);
    const cs: Candle[] = [];
    let px = 1000;
    let regime = rand() < 0.5 ? -1 : 1;
    for (let i = 0; i < 320; i++) {
      if (i % 24 === 0) regime = rand() < 0.5 ? -1 : 1; // trend regimes so reversal contexts occur
      const o = px;
      const drift = regime * 2.2 + (rand() - 0.5) * 5;
      const c = Math.max(o + drift, 100);
      const h = Math.max(o, c) + rand() * 2.5;
      const l = Math.min(o, c) - rand() * 2.5;
      cs.push(bar(o, h, l, c));
      px = c;
    }
    // evaluate on candle closes like the scanner does (every 8th bar)
    for (let cut = 60; cut <= cs.length; cut += 8) {
      const slice = cs.slice(0, cut);
      for (const id of allIds) {
        let sig: ReturnType<typeof runOne> | null = null;
        try {
          sig = runPatternDetectors(slice, [id], {})[0] ?? null;
        } catch (e) {
          failures.push(`detector ${id} threw on walk seed=${seed} cut=${cut}: ${(e as Error).message}`);
          console.log(`  ✗ ${id} threw:`, (e as Error).message);
          continue;
        }
        evals++;
        if (sig) {
          fired++;
          const longOk = sig.side === "LONG" ? sig.sl < sig.entry && sig.target > sig.entry : sig.sl > sig.entry && sig.target < sig.entry;
          if (!longOk) levelErrors++;
        }
      }
    }
  }
  console.log(`   ${evals} evaluations · ${fired} signals fired across all detectors`);
  check("no detector threw", !failures.some((f) => f.includes("threw")));
  check("levels sane on every fired signal", levelErrors === 0, `${levelErrors} bad`);
  check("walks produce signals", fired >= 20, `only ${fired}`);
}

console.log("");
if (failures.length > 0) {
  console.log(`FAILED (${failures.length}):`);
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
} else {
  console.log(`ALL TESTS PASSED (${pass} checks)`);
}
