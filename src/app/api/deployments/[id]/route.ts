import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { legsUnrealized } from "@/lib/pnl";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  getEngine();
  const { id } = await ctx.params;
  const d = await db.deployment.findUnique({ where: { id }, include: { legs: true } });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [orders, events] = await Promise.all([
    db.order.findMany({ where: { deploymentId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.event.findMany({ where: { deploymentId: id }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const unrealized = legsUnrealized(d.legs);
  return NextResponse.json({
    deployment: { ...d, unrealized, totalPnl: Math.round((d.realizedPnl + unrealized) * 100) / 100 },
    orders,
    events,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const existing = await db.deployment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status === "RUNNING") {
    return NextResponse.json({ error: "Stop the deployment before editing." }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name);
  if (body.lots !== undefined) data.lots = Math.max(1, parseInt(String(body.lots), 10) || 1);
  if (body.legSlPct !== undefined) data.legSlPct = Math.min(100, Math.max(5, Number(body.legSlPct) || 50));
  if (body.targetProfit !== undefined) {
    const t = Number(body.targetProfit);
    data.targetProfit = Number.isFinite(t) && t > 0 ? t : null;
  }
  if (body.entryTime !== undefined) data.entryTime = String(body.entryTime);
  if (body.squareOffTime !== undefined) data.squareOffTime = String(body.squareOffTime);
  if (body.otmGap !== undefined) data.otmGap = Math.max(0, parseInt(String(body.otmGap), 10) || 0);
  if (body.wingGap !== undefined) data.wingGap = Math.max(0, parseInt(String(body.wingGap), 10) || 0);
  if (body.expiryMode !== undefined) {
    data.expiryMode = body.expiryMode === "NEXT" ? "NEXT" : "NEAREST";
    data.expiryDate = null; // re-resolve at next entry
  }
  const d = await db.deployment.update({ where: { id }, data });
  await db.event.create({ data: { deploymentId: id, type: "INFO", message: "Deployment settings updated." } });
  return NextResponse.json({ deployment: d });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = await db.deployment.findUnique({ where: { id }, include: { legs: true } });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (d.legs.some((l) => l.status === "OPEN")) {
    return NextResponse.json({ error: "Square off open legs before deleting." }, { status: 400 });
  }
  await db.deployment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
