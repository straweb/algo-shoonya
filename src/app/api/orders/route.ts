import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  getEngine();
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const deploymentId = url.searchParams.get("deploymentId");
  const status = url.searchParams.get("status");
  const take = Math.min(500, parseInt(url.searchParams.get("take") ?? "200", 10));

  const where: Record<string, unknown> = {};
  if (mode === "PAPER" || mode === "LIVE") where.mode = mode;
  if (deploymentId) where.deploymentId = deploymentId;
  if (status) where.status = status;

  const orders = await db.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: { deployment: { select: { name: true, instrument: true, strategyType: true } } },
  });
  return NextResponse.json({ orders });
}
