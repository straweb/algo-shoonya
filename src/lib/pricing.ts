// Black-Scholes pricing used by the paper-trading simulator.
// Good enough for MTM simulation of index options; live mode uses broker quotes.

function normCdf(x: number): number {
  // Abramowitz-Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const nd = 1 - (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * poly;
  return x >= 0 ? nd : 1 - nd;
}

export interface PriceInputs {
  spot: number;
  strike: number;
  iv: number; // annualised, e.g. 0.12
  yearsToExpiry: number; // remaining calendar time
  type: "CE" | "PE";
  rate?: number;
}

export function blackScholes({
  spot,
  strike,
  iv,
  yearsToExpiry,
  type,
  rate = 0.065,
}: PriceInputs): number {
  const T = Math.max(yearsToExpiry, 0.15 / (365 * 24)); // floor ~9 minutes
  const sigT = iv * Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (rate + (iv * iv) / 2) * T) / sigT;
  const d2 = d1 - sigT;
  const disc = Math.exp(-rate * T);
  if (type === "CE") {
    return Math.max(spot * normCdf(d1) - strike * disc * normCdf(d2), Math.max(spot - strike, 0));
  }
  return Math.max(strike * disc * normCdf(-d2) - spot * normCdf(-d1), Math.max(strike - spot, 0));
}

/** Round to the ₹0.05 tick. */
export function roundTick(p: number): number {
  return Math.max(0.05, Math.round(p / 0.05) * 0.05);
}

let gaussSpare: number | null = null;
export function gaussian(): number {
  if (gaussSpare !== null) {
    const v = gaussSpare;
    gaussSpare = null;
    return v;
  }
  let u = 0;
  let v = 0;
  let s = 0;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s === 0 || s >= 1);
  const mul = Math.sqrt((-2 * Math.log(s)) / s);
  gaussSpare = v * mul;
  return u * mul;
}

export interface PaperLeg {
  spot: number;
  strike: number;
  iv: number;
  yearsToExpiry: number;
  type: "CE" | "PE";
}

export function paperPremium(leg: PaperLeg): number {
  return roundTick(blackScholes({ ...leg, iv: leg.iv }));
}
