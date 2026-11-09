// Index option instruments traded on Shoonya (NFO + BFO)
// Lot sizes verified for Nov 2026 contracts:
//  NIFTY 65 | BANKNIFTY 30 | FINNIFTY 60 | MIDCPNIFTY 120 | SENSEX 20 | BANKEX 30
// Expiry rules (2026): NIFTY weekly Tue; SENSEX weekly Thu;
//  NSE monthlies last Tue; BSE monthlies last Thu.

export type InstrumentId =
  | "NIFTY"
  | "BANKNIFTY"
  | "FINNIFTY"
  | "MIDCPNIFTY"
  | "SENSEX"
  | "BANKEX";

export interface InstrumentDef {
  id: InstrumentId;
  label: string;
  exchange: "NFO" | "BFO";
  lotSize: number;
  strikeStep: number;
  iv: number; // implied vol used by the paper-pricing engine
  basePrice: number; // simulated spot anchor for paper mode
  weekly: boolean;
  weeklyDay: number; // 0=Sun..6=Sat (ISO weekday of weekly expiry)
  monthlyDay: number; // weekday of monthly expiry
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  NIFTY: {
    id: "NIFTY",
    label: "Nifty 50",
    exchange: "NFO",
    lotSize: 65,
    strikeStep: 50,
    iv: 0.12,
    basePrice: 25900,
    weekly: true,
    weeklyDay: 2, // Tuesday
    monthlyDay: 2,
  },
  BANKNIFTY: {
    id: "BANKNIFTY",
    label: "Nifty Bank",
    exchange: "NFO",
    lotSize: 30,
    strikeStep: 100,
    iv: 0.14,
    basePrice: 57500,
    weekly: false,
    weeklyDay: 2,
    monthlyDay: 2,
  },
  FINNIFTY: {
    id: "FINNIFTY",
    label: "Nifty Financial Services",
    exchange: "NFO",
    lotSize: 60,
    strikeStep: 50,
    iv: 0.13,
    basePrice: 26500,
    weekly: false,
    weeklyDay: 2,
    monthlyDay: 2,
  },
  MIDCPNIFTY: {
    id: "MIDCPNIFTY",
    label: "Nifty Midcap Select",
    exchange: "NFO",
    lotSize: 120,
    strikeStep: 25,
    iv: 0.16,
    basePrice: 13200,
    weekly: false,
    weeklyDay: 2,
    monthlyDay: 2,
  },
  SENSEX: {
    id: "SENSEX",
    label: "BSE Sensex",
    exchange: "BFO",
    lotSize: 20,
    strikeStep: 100,
    iv: 0.12,
    basePrice: 85500,
    weekly: true,
    weeklyDay: 4, // Thursday
    monthlyDay: 4,
  },
  BANKEX: {
    id: "BANKEX",
    label: "BSE Bankex",
    exchange: "BFO",
    lotSize: 30,
    strikeStep: 100,
    iv: 0.13,
    basePrice: 64500,
    weekly: false,
    weeklyDay: 4,
    monthlyDay: 4,
  },
};

export const INSTRUMENT_LIST: InstrumentDef[] = Object.values(INSTRUMENTS);

export function getInstrument(id: string): InstrumentDef {
  const inst = INSTRUMENTS[id as InstrumentId];
  if (!inst) throw new Error(`Unknown instrument ${id}`);
  return inst;
}

/** Round a spot value to the nearest tradable strike. */
export function roundStrike(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Shoonya tradingsymbol: NIFTY12NOV2626000CE / SENSEX12NOV2685500CE */
export function optionSymbol(
  inst: InstrumentDef,
  expiry: Date,
  strike: number,
  type: "CE" | "PE",
): string {
  const d = expiry.getDate().toString().padStart(2, "0");
  const m = MONTHS[expiry.getMonth()];
  const y = expiry.getFullYear().toString().slice(2);
  return `${inst.id}${d}${m}${y}${strike}${type}`;
}

function atExpiryHour(date: Date): Date {
  const d = new Date(date.getTime());
  // expiry settles at 15:30 IST = 10:00 UTC
  d.setUTCHours(10, 0, 0, 0);
  return d;
}

function nextWeekday(from: Date, weekday: number, includeToday: boolean): Date {
  const d = new Date(from.getTime());
  d.setUTCHours(0, 0, 0, 0);
  if (includeToday && d.getUTCDay() === weekday) return d;
  for (let i = 1; i <= 7; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() === weekday) return d;
  }
  return d;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const d = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * Compute the ordered list of upcoming option expiries for an index.
 * Weekly indices get weekly + monthly contracts; others only monthly.
 * Dates are UTC-midnight of expiry day (IST weekday), listed soonest first.
 */
export function upcomingExpiries(inst: InstrumentDef, now: Date = new Date()): Date[] {
  const out: Date[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  // next 3 monthly expiries
  const monthlies: Date[] = [];
  for (let i = 0; i < 3; i++) {
    const mm = m + i;
    const yy = y + Math.floor(mm / 12);
    const md = lastWeekdayOfMonth(yy, mm % 12, inst.monthlyDay);
    if (atExpiryHour(md).getTime() >= atExpiryHour(now).getTime() - 86400000) monthlies.push(md);
  }

  if (inst.weekly) {
    const weeks: Date[] = [];
    let cursor = new Date(now.getTime());
    for (let i = 0; i < 4; i++) {
      const w = nextWeekday(cursor, inst.weeklyDay, i === 0);
      if (atExpiryHour(w).getTime() < atExpiryHour(now).getTime()) {
        cursor = new Date(w.getTime() + 86400000);
        continue;
      }
      weeks.push(w);
      cursor = new Date(w.getTime() + 86400000);
    }
    out.push(...weeks);
  }

  for (const md of monthlies) {
    if (!out.some((d) => d.getTime() === md.getTime())) out.push(md);
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/** NEAREST = next expiry; NEXT = the one after. */
export function resolveExpiry(
  inst: InstrumentDef,
  mode: "NEAREST" | "NEXT",
  now: Date = new Date(),
): { date: Date; label: string } {
  const list = upcomingExpiries(inst, now);
  const idx = mode === "NEAREST" ? 0 : Math.min(1, list.length - 1);
  const date = list[idx] ?? list[0];
  return { date, label: formatDateLabel(date) };
}

export function formatDateLabel(d: Date): string {
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function expiryISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
