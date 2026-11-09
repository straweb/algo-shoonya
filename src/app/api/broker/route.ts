import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { shoonyaLogin, ShoonyaCreds } from "@/lib/shoonya";

export const dynamic = "force-dynamic";

function mask(s: string | null | undefined): string | null {
  if (!s) return null;
  if (s.length <= 4) return "••••";
  return `${s.slice(0, 2)}•••${s.slice(-2)}`;
}

export async function GET() {
  getEngine();
  const acct = await db.brokerAccount.findUnique({ where: { id: "shoonya" } });
  if (!acct) {
    return NextResponse.json({ configured: false, status: "NOT_CONFIGURED" });
  }
  return NextResponse.json({
    configured: !!acct.userId,
    status: acct.lastStatus,
    userId: acct.userId,
    passwordMask: mask(acct.password),
    factor2Mask: mask(acct.factor2),
    vendorCode: acct.vendorCode,
    apiKeyMask: mask(acct.apiKey),
    imei: acct.imei,
    hasTotp: !!acct.totpSecret,
    accountId: acct.accountId,
    lastLoginAt: acct.lastLoginAt,
    lastError: acct.lastError,
  });
}

export async function POST(req: NextRequest) {
  getEngine();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { userId, password, factor2, vendorCode, apiKey, imei, totpSecret } = body as Record<string, string>;
  if (!userId || !password || !apiKey) {
    return NextResponse.json({ error: "User ID, password and API key are required." }, { status: 400 });
  }

  const creds: ShoonyaCreds = {
    userId: userId.trim(),
    password: password.trim(),
    factor2: (factor2 ?? "").trim(),
    vendorCode: (vendorCode ?? "").trim(),
    apiKey: apiKey.trim(),
    imei: (imei ?? "shoonyaalgo01").trim(),
    totpSecret: (totpSecret ?? "").trim() || null,
  };

  const test = await shoonyaLogin(creds);
  const existing = await db.brokerAccount.findUnique({ where: { id: "shoonya" } });

  await db.brokerAccount.upsert({
    where: { id: "shoonya" },
    update: {
      userId: creds.userId,
      password: creds.password,
      factor2: creds.factor2,
      vendorCode: creds.vendorCode,
      apiKey: creds.apiKey,
      imei: creds.imei,
      totpSecret: creds.totpSecret,
      lastStatus: test.ok ? "CONNECTED" : "ERROR",
      lastError: test.ok ? null : test.error ?? "Login failed",
      lastLoginAt: test.ok ? new Date() : existing?.lastLoginAt ?? null,
      sessionToken: test.ok ? test.token ?? null : null,
      accountId: test.ok ? test.account ?? null : null,
      sessionExpires: test.ok ? new Date(Date.now() + 23 * 3600 * 1000) : null,
    },
    create: {
      id: "shoonya",
      userId: creds.userId,
      password: creds.password,
      factor2: creds.factor2,
      vendorCode: creds.vendorCode,
      apiKey: creds.apiKey,
      imei: creds.imei,
      totpSecret: creds.totpSecret,
      lastStatus: test.ok ? "CONNECTED" : "ERROR",
      lastError: test.ok ? null : test.error ?? "Login failed",
      lastLoginAt: test.ok ? new Date() : null,
      sessionToken: test.ok ? test.token ?? null : null,
      accountId: test.ok ? test.account ?? null : null,
      sessionExpires: test.ok ? new Date(Date.now() + 23 * 3600 * 1000) : null,
    },
  });

  if (test.ok) {
    const engine = getEngine();
    engine.brokerSession = { token: test.token!, actid: test.account ?? creds.userId, userId: creds.userId };
    await db.event.create({
      data: { type: "BROKER", message: `Shoonya account ${mask(creds.userId)} connected — live mode enabled.` },
    });
  }

  return NextResponse.json({
    ok: test.ok,
    error: test.error,
    note: test.ok
      ? "Connected. Credentials are stored locally in this machine's database only."
      : "Credentials saved, but the live login failed. Paper mode keeps working; fix the error and retry.",
  });
}

export async function DELETE() {
  getEngine();
  await db.brokerAccount.update({
    where: { id: "shoonya" },
    data: { sessionToken: null, lastStatus: "NOT_CONFIGURED", sessionExpires: null },
  });
  (getEngine() as unknown as { brokerSession: unknown }).brokerSession = null;
  return NextResponse.json({ ok: true });
}
