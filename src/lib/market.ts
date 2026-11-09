// IST market clock helpers. All strategy times are Asia/Kolkata (IST, UTC+5:30).

export interface IstNow {
  date: Date;
  yyyy: number;
  mm: number; // 1-12
  dd: number;
  dow: number; // 0 Sun .. 6 Sat
  hh: number;
  minute: number;
  seconds: number;
  hhmm: string; // "09:20"
}

export function istNow(now: Date = new Date()): IstNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hh = parseInt(get("hour") === "24" ? "00" : get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: now,
    yyyy: parseInt(get("year"), 10),
    mm: parseInt(get("month"), 10),
    dd: parseInt(get("day"), 10),
    dow: dowMap[get("weekday").slice(0, 3)] ?? now.getUTCDay(),
    hh,
    minute,
    seconds: parseInt(get("second"), 10),
    hhmm: `${String(hh).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** True when NSE/BSE cash+derivatives market is open (Mon-Fri 09:15-15:30 IST). */
export function isMarketOpen(t: IstNow): boolean {
  if (t.dow === 0 || t.dow === 6) return false;
  const mins = t.hh * 60 + t.minute;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

export function isValidHhmm(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** "2h 05m" style label for time to expiry. */
export function timeToExpiryLabel(expiryISODate: string, now: Date = new Date()): string {
  // expiry settle 15:30 IST = 10:00 UTC
  const [y, m, d] = expiryISODate.split("-").map((x) => parseInt(x, 10));
  const settle = Date.UTC(y, m - 1, d, 10, 0, 0);
  const diff = Math.max(0, settle - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}
