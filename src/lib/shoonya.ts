// Shoonya (Finvasia) Noren REST client — server-side only.
// Docs: https://shoonya.com/api-documentation
// Base: https://api.shoonya.com/NorenWClientTP

const HOST = "https://api.shoonya.com/NorenWClientTP";
const APK_VERSION = "1.0.0";

export interface ShoonyaCreds {
  userId: string;
  password: string;
  factor2: string; // PAN / 2FA
  vendorCode: string;
  apiKey: string; // app_idkey
  imei: string;
  totpSecret?: string | null;
}

export interface LoginResult {
  ok: boolean;
  token?: string;
  error?: string;
  account?: string;
}

export interface PlaceOrderParams {
  exchange: string; // NFO | BFO
  symbol: string; // tradingsymbol
  qty: number;
  side: "B" | "S";
  price: number; // 0 for MKT
  priceType: "MKT" | "LMT";
  product: "I" | "M"; // intraday / NRML
  remarks?: string;
}

async function post(path: string, jData: object, jKey?: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  params.set("jData", JSON.stringify(jData));
  if (jKey) params.set("jKey", jKey);
  const res = await fetch(`${HOST}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return (await res.json()) as Record<string, unknown>;
}

/** QuickAuth login. factor2 may be PAN or a live TOTP if totpSecret is configured. */
export async function shoonyaLogin(creds: ShoonyaCreds): Promise<LoginResult> {
  try {
    const { generateTotp } = await import("./totp");
    const factor2 = creds.totpSecret ? generateTotp(creds.totpSecret) : creds.factor2;
    const resp = await post("QuickAuth", {
      apk: APK_VERSION,
      source: "API",
      uid: creds.userId,
      pwd: creds.password,
      factor2,
      vc: creds.vendorCode,
      app_idkey: creds.apiKey,
      imei: creds.imei,
      dedlite_flag: "NA",
    });
    if (resp.stat === "Ok" && resp.susertoken) {
      return { ok: true, token: String(resp.susertoken), account: String(resp.actid ?? creds.userId) };
    }
    return { ok: false, error: String(resp.emsg ?? "Login rejected") };
  } catch (e) {
    return { ok: false, error: `Network error reaching Shoonya: ${(e as Error).message}` };
  }
}

/** LTP quote for a tradingsymbol. Returns null when unreachable. */
export async function shoonyaQuote(
  token: string,
  userId: string,
  exchange: string,
  symbol: string,
): Promise<number | null> {
  try {
    const resp = await post("GetQuotes", { uid: userId, exch: exchange, tsym: symbol }, token);
    if (resp.stat === "Ok" && resp.lp !== undefined && resp.lp !== null && resp.lp !== "") {
      return parseFloat(String(resp.lp));
    }
    return null;
  } catch {
    return null;
  }
}

export interface PlaceOrderResult {
  ok: boolean;
  orderId?: string;
  error?: string;
}

/** Market/Limit order. */
export async function shoonyaPlaceOrder(
  token: string,
  actid: string,
  userId: string,
  p: PlaceOrderParams,
): Promise<PlaceOrderResult> {
  try {
    const resp = await post(
      "PlaceOrder",
      {
        uid: userId,
        actid,
        exch: p.exchange,
        tsym: p.symbol,
        qty: p.qty,
        prc: p.price,
        trgprc: 0,
        prd: p.product,
        trantype: p.side,
        prctyp: p.priceType,
        ret: "DAY",
        remarks: p.remarks ?? "ShoonyaAlgo",
      },
      token,
    );
    if (resp.stat === "Ok" && resp.norenordno) {
      return { ok: true, orderId: String(resp.norenordno) };
    }
    return { ok: false, error: String(resp.emsg ?? "Order rejected") };
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}` };
  }
}

/** Search scrips to verify a tradingsymbol exists (used before entry in live mode). */
export async function shoonyaSearch(
  token: string,
  userId: string,
  exchange: string,
  searchText: string,
): Promise<Array<{ tsym: string; token: string }> | null> {
  try {
    const resp = await post("SearchScrips", { uid: userId, exch: exchange, stext: searchText }, token);
    if (resp.stat === "Ok" && Array.isArray(resp.values)) {
      return resp.values.map((v: Record<string, unknown>) => ({
        tsym: String(v.tsym ?? ""),
        token: String(v.token ?? ""),
      }));
    }
    return null;
  } catch {
    return null;
  }
}
