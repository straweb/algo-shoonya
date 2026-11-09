import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { istNow, isMarketOpen } from "@/lib/market";

export const dynamic = "force-dynamic";

type Action = "start" | "stop" | "pause" | "resume" | "flatten";

interface CloseDeployable {
  closeDeployment: (d: unknown, eventType: string, newStatus: string, message: string) => Promise<void>;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const engine = getEngine();
  const { id } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: Action };
  if (!action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  const d = await db.deployment.findUnique({ where: { id }, include: { legs: true } });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const openLegs = d.legs.filter((l) => l.status === "OPEN");
  const now = istNow();

  switch (action) {
    case "start": {
      if (d.status === "RUNNING") return NextResponse.json({ error: "Already running" }, { status: 400 });
      // fresh day start: clear old legs, reset realized pnl, re-resolve expiry
      await db.leg.deleteMany({ where: { deploymentId: d.id, status: { not: "OPEN" } } });
      await db.deployment.update({
        where: { id: d.id },
        data: { status: "RUNNING", statusNote: null, startedAt: new Date(), stoppedAt: null, realizedPnl: 0, expiryDate: null },
      });
      await db.event.create({
        data: {
          deploymentId: d.id,
          type: "STARTED",
          message: isMarketOpen(now)
            ? `Deployment started. Entry at/after ${d.entryTime} IST — watching ${d.instrument} ${d.strategyType.replace(/_/g, " ")}.`
            : `Deployment started. Market closed (IST ${now.hhmm}) — will enter when market reopens at ${d.entryTime}.`,
        },
      });
      break;
    }
    case "pause": {
      if (d.status !== "RUNNING") return NextResponse.json({ error: "Not running" }, { status: 400 });
      await db.deployment.update({ where: { id: d.id }, data: { status: "PAUSED", statusNote: "Paused by user — entries and risk checks suspended." } });
      await db.event.create({ data: { deploymentId: d.id, type: "PAUSED", message: "Paused by user. Open legs keep marking to market but SL/target checks are suspended." } });
      break;
    }
    case "resume": {
      if (d.status !== "PAUSED") return NextResponse.json({ error: "Not paused" }, { status: 400 });
      await db.deployment.update({ where: { id: d.id }, data: { status: "RUNNING", statusNote: null } });
      await db.event.create({ data: { deploymentId: d.id, type: "STARTED", message: "Resumed by user — SL / target / timed-exit checks active again." } });
      break;
    }
    case "stop": {
      if (!["RUNNING", "PAUSED", "ERROR"].includes(d.status)) return NextResponse.json({ error: "Not active" }, { status: 400 });
      if (openLegs.length > 0) {
        await (engine as unknown as CloseDeployable).closeDeployment(
          d,
          "SQUARE_OFF",
          "STOPPED",
          `Manual stop by user — ${openLegs.length} leg(s) squared off at market.`,
        );
      } else {
        await db.deployment.update({ where: { id: d.id }, data: { status: "STOPPED", stoppedAt: new Date(), statusNote: "Stopped by user." } });
        await db.event.create({ data: { deploymentId: d.id, type: "STOPPED", message: "Stopped by user (no open legs)." } });
      }
      break;
    }
    case "flatten": {
      if (openLegs.length === 0) return NextResponse.json({ error: "No open legs" }, { status: 400 });
      await (engine as unknown as CloseDeployable).closeDeployment(
        d,
        "SQUARE_OFF",
        "STOPPED",
        `Manual square-off by user — ${openLegs.length} leg(s) closed at market.`,
      );
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
