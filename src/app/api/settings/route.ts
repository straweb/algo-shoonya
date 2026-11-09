import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { isValidHhmm } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  getEngine();
  let settings = await db.settings.findUnique({ where: { id: "global" } });
  if (!settings) {
    settings = await db.settings.create({ data: { id: "global" } });
  }
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  getEngine();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.dayMaxLoss !== undefined) {
    const v = Number(body.dayMaxLoss);
    if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: "Day max loss must be a positive number" }, { status: 400 });
    data.dayMaxLoss = v;
  }
  if (body.paperCapital !== undefined) {
    const v = Number(body.paperCapital);
    if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: "Paper capital must be positive" }, { status: 400 });
    data.paperCapital = v;
  }
  if (body.defaultSquareOff !== undefined) {
    const v = String(body.defaultSquareOff);
    if (!isValidHhmm(v)) return NextResponse.json({ error: "Square-off must be HH:MM" }, { status: 400 });
    data.defaultSquareOff = v;
  }
  if (body.paperSimulate !== undefined) {
    data.paperSimulate = !!body.paperSimulate;
  }
  if (body.activeInstruments !== undefined) {
    const list = Array.isArray(body.activeInstruments) ? body.activeInstruments : String(body.activeInstruments).split(",");
    const valid = list.map((s: string) => String(s).trim().toUpperCase()).filter((s: string) =>
      ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"].includes(s),
    );
    if (valid.length === 0) return NextResponse.json({ error: "At least one instrument must be active" }, { status: 400 });
    data.activeInstruments = valid.join(",");
  }

  const settings = await db.settings.upsert({
    where: { id: "global" },
    update: data,
    create: { id: "global", ...data },
  });
  return NextResponse.json({ settings });
}
