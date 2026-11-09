"use client";

import { useMemo } from "react";
import { pnlClass } from "@/lib/client-types";
import { cn } from "@/lib/utils";

/** Lightweight SVG area sparkline for realized P&L. */
export function Sparkline({ points, height = 160 }: { points: Array<{ t: string; pnl: number }>; height?: number }) {
  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const xs = points.map((_, i) => i);
    const ys = points.map((p) => p.pnl);
    const minY = Math.min(0, ...ys);
    const maxY = Math.max(0, ...ys);
    const pad = (maxY - minY) * 0.15 || 100;
    const lo = minY - pad;
    const hi = maxY + pad;
    const W = 600;
    const H = height;
    const x = (i: number) => (xs[i] / (points.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.pnl).toFixed(1)}`).join(" ");
    const area = `${line} L${W},${H} L0,${H} Z`;
    const last = ys[ys.length - 1];
    const zeroY = y(0);
    return { line, area, last, zeroY, W, H, positive: last >= 0 };
  }, [points, height]);

  if (!chart) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        P&amp;L curve appears once legs start closing.
      </div>
    );
  }

  const stroke = chart.positive ? "stroke-emerald-500" : "stroke-rose-500";
  const fill = chart.positive ? "fill-emerald-500/10" : "fill-rose-500/10";

  return (
    <div>
      <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label="Realized P&L sparkline">
        <line x1={0} x2={chart.W} y1={chart.zeroY} y2={chart.zeroY} className="stroke-zinc-300 dark:stroke-zinc-700" strokeDasharray="4 4" strokeWidth={1} />
        <path d={chart.area} className={cn(fill, stroke)} strokeWidth={0} />
        <path d={chart.line} className={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between text-xs">
        <span className="text-muted-foreground">cumulative realized</span>
        <span className={cn("font-semibold tabular-nums", pnlClass(chart.last))}>
          {chart.last >= 0 ? "+" : "-"}₹{Math.abs(chart.last).toLocaleString("en-IN")}
        </span>
      </div>
    </div>
  );
}
