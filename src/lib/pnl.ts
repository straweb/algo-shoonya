import type { LegLike } from "./engine";

/** Unrealized MTM for a set of legs at their stored LTPs. */
export function legsUnrealized(legs: LegLike[]): number {
  let u = 0;
  for (const l of legs) {
    if (l.status !== "OPEN") continue;
    const dir = l.side === "SELL" ? -1 : 1;
    u += dir * ((l.ltp ?? 0) - (l.entryPrice ?? 0)) * l.qty;
  }
  return Math.round(u * 100) / 100;
}

export function pnlColorClass(v: number): string {
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-rose-600 dark:text-rose-400";
  return "text-muted-foreground";
}

export function inr(v: number, sign = false): string {
  const s = v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  if (sign && v > 0) return `+₹${s}`;
  if (sign && v < 0) return `-₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  return `₹${s}`;
}
