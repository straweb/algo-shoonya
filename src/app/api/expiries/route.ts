import { NextRequest, NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";
import { getInstrument, resolveExpiry, upcomingExpiries, formatDateLabel, expiryISO } from "@/lib/instruments";
import { timeToExpiryLabel } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const engine = getEngine();
  const url = new URL(req.url);
  const instrumentId = url.searchParams.get("instrument") ?? "NIFTY";
  let inst;
  try {
    inst = getInstrument(instrumentId);
  } catch {
    return NextResponse.json({ error: "Unknown instrument" }, { status: 400 });
  }
  const now = new Date();
  const list = upcomingExpiries(inst, now);
  const spot = engine.spot(inst.id);

  const isMonthly = (d: Date) =>
    d.getUTCMonth() !== new Date(d.getTime() + 7 * 86400000).getUTCMonth();

  const expiries = list.slice(0, 4).map((d, i) => ({
    mode: i === 0 ? "NEAREST" : i === 1 ? "NEXT" : `+${i}`,
    iso: expiryISO(d),
    label: formatDateLabel(d),
    daysLeft: Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86400000)),
    tte: timeToExpiryLabel(expiryISO(d), now),
    kind: isMonthly(d) ? "MONTHLY" : "WEEKLY",
  }));

  const nearest = resolveExpiry(inst, "NEAREST", now);
  const next = resolveExpiry(inst, "NEXT", now);

  return NextResponse.json({
    instrument: inst.id,
    exchange: inst.exchange,
    lotSize: inst.lotSize,
    strikeStep: inst.strikeStep,
    spot: Math.round(spot * 100) / 100,
    nearest: { iso: expiryISO(nearest.date), label: nearest.label },
    next: { iso: expiryISO(next.date), label: next.label },
    expiries,
  });
}
