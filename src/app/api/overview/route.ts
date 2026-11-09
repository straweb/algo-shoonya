import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { legsUnrealized } from "@/lib/pnl";
import { istNow, isMarketOpen } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getEngine(); // keep tick loop alive
  const now = istNow();

  const [settings, deployments, ordersCount, events] = await Promise.all([
    db.settings.findUnique({ where: { id: "global" } }),
    db.deployment.findMany({ include: { legs: true }, orderBy: { createdAt: "desc" } }),
    db.order.count(),
    db.event.findMany({ orderBy: { createdAt: "desc" }, take: 12, include: { deployment: { select: { name: true } } } }),
  ]);

  const withPnl = deployments.map((d) => {
    const unrealized = legsUnrealized(d.legs);
    return {
      id: d.id,
      name: d.name,
      strategyType: d.strategyType,
      instrument: d.instrument,
      expiryMode: d.expiryMode,
      expiryDate: d.expiryDate,
      mode: d.mode,
      status: d.status,
      statusNote: d.statusNote,
      lots: d.lots,
      capital: d.capital,
      entryTime: d.entryTime,
      squareOffTime: d.squareOffTime,
      realizedPnl: d.realizedPnl,
      unrealized,
      totalPnl: Math.round((d.realizedPnl + unrealized) * 100) / 100,
      openLegs: d.legs.filter((l) => l.status === "OPEN").length,
      totalLegs: d.legs.length,
      createdAt: d.createdAt,
    };
  });

  const totalPnl = Math.round(withPnl.reduce((s, d) => s + d.totalPnl, 0) * 100) / 100;
  const allocated = withPnl
    .filter((d) => ["RUNNING", "PAUSED"].includes(d.status))
    .reduce((s, d) => s + d.capital, 0);

  const dayMaxLoss = settings?.dayMaxLoss ?? 10000;
  const lossUsed = totalPnl < 0 ? Math.min(100, (-totalPnl / Math.abs(dayMaxLoss)) * 100) : 0;

  // realized pnl sparkline from closed legs (last 24h)
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const closedLegs = await db.leg.findMany({
    where: { status: { startsWith: "CLOSED" }, closedAt: { gte: since } },
    orderBy: { closedAt: "asc" },
  });
  let cum = 0;
  const pnlSeries = closedLegs.map((l) => {
    cum += l.realizedPnl;
    return { t: l.closedAt?.toISOString() ?? "", pnl: Math.round(cum * 100) / 100 };
  });

  const broker = await db.brokerAccount.findUnique({ where: { id: "shoonya" } });

  return NextResponse.json({
    market: {
      open: isMarketOpen(now),
      sim: !isMarketOpen(now) && (settings?.paperSimulate ?? true),
      istTime: now.hhmm,
      istDate: `${now.dd}/${String(now.mm).padStart(2, "0")}/${now.yyyy}`,
      dow: now.dow,
    },
    settings,
    totals: {
      allocated: Math.round(allocated),
      totalPnl,
      realized: Math.round(withPnl.reduce((s, d) => s + d.realizedPnl, 0) * 100) / 100,
      unrealized: Math.round(withPnl.reduce((s, d) => s + d.unrealized, 0) * 100) / 100,
      running: withPnl.filter((d) => d.status === "RUNNING").length,
      paused: withPnl.filter((d) => d.status === "PAUSED").length,
      total: withPnl.length,
      ordersCount,
    },
    killSwitch: { dayMaxLoss, lossUsed },
    deployments: withPnl,
    events,
    pnlSeries,
    paperSpots: Object.fromEntries(
      ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"].map((k) => [
        k,
        Math.round(engine.spot(k as never) * 100) / 100,
      ]),
    ),
    brokerStatus: broker
      ? { configured: !!broker.userId, status: broker.lastStatus, userId: broker.userId ? `${broker.userId.slice(0, 2)}•••` : null, lastError: broker.lastError }
      : { configured: false, status: "NOT_CONFIGURED", userId: null, lastError: null },
  });
}
