import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  getEngine();
  const url = new URL(req.url);
  const deploymentId = url.searchParams.get("deploymentId");
  const take = Math.min(300, parseInt(url.searchParams.get("take") ?? "80", 10));
  const events = await db.event.findMany({
    where: deploymentId ? { deploymentId } : {},
    orderBy: { createdAt: "desc" },
    take,
    include: { deployment: { select: { name: true } } },
  });
  return NextResponse.json({ events });
}
