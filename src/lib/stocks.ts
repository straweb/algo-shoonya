// Stock scanner universe — liquid NSE F&O names.
// Prices are simulated anchors for the paper scanner (same approach as the
// index paper engine); live mode replaces them with real NSE quotes.

import { INSTRUMENT_LIST } from "./instruments";

export interface StockDef {
  symbol: string;
  name: string;
  basePrice: number;
  vol: number; // annualised vol used by the paper walk
}

export const STOCK_UNIVERSE: StockDef[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", basePrice: 1550, vol: 0.22 },
  { symbol: "HDFCBANK", name: "HDFC Bank", basePrice: 2100, vol: 0.2 },
  { symbol: "ICICIBANK", name: "ICICI Bank", basePrice: 1500, vol: 0.22 },
  { symbol: "INFY", name: "Infosys", basePrice: 1720, vol: 0.24 },
  { symbol: "TCS", name: "Tata Consultancy Svcs", basePrice: 3050, vol: 0.22 },
  { symbol: "SBIN", name: "State Bank of India", basePrice: 950, vol: 0.26 },
  { symbol: "AXISBANK", name: "Axis Bank", basePrice: 1330, vol: 0.25 },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", basePrice: 2180, vol: 0.23 },
  { symbol: "LT", name: "Larsen & Toubro", basePrice: 3900, vol: 0.25 },
  { symbol: "ITC", name: "ITC", basePrice: 415, vol: 0.19 },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", basePrice: 2050, vol: 0.23 },
  { symbol: "TATAMOTORS", name: "Tata Motors", basePrice: 720, vol: 0.3 },
  { symbol: "TATASTEEL", name: "Tata Steel", basePrice: 180, vol: 0.3 },
  { symbol: "M&M", name: "Mahindra & Mahindra", basePrice: 3300, vol: 0.27 },
  { symbol: "MARUTI", name: "Maruti Suzuki", basePrice: 13500, vol: 0.23 },
  { symbol: "TITAN", name: "Titan Company", basePrice: 3600, vol: 0.26 },
  { symbol: "ASIANPAINT", name: "Asian Paints", basePrice: 2350, vol: 0.23 },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical", basePrice: 1700, vol: 0.22 },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", basePrice: 2450, vol: 0.19 },
  { symbol: "BAJFINANCE", name: "Bajaj Finance", basePrice: 1050, vol: 0.29 },
  { symbol: "HCLTECH", name: "HCL Technologies", basePrice: 1650, vol: 0.24 },
  { symbol: "WIPRO", name: "Wipro", basePrice: 250, vol: 0.25 },
  { symbol: "TECHM", name: "Tech Mahindra", basePrice: 1600, vol: 0.26 },
  { symbol: "NTPC", name: "NTPC", basePrice: 340, vol: 0.24 },
  { symbol: "POWERGRID", name: "Power Grid Corp", basePrice: 290, vol: 0.22 },
  { symbol: "ONGC", name: "Oil & Natural Gas Corp", basePrice: 260, vol: 0.27 },
  { symbol: "COALINDIA", name: "Coal India", basePrice: 420, vol: 0.26 },
  { symbol: "JSWSTEEL", name: "JSW Steel", basePrice: 1150, vol: 0.28 },
  { symbol: "HINDALCO", name: "Hindalco Industries", basePrice: 780, vol: 0.29 },
  { symbol: "ADANIENT", name: "Adani Enterprises", basePrice: 2400, vol: 0.36 },
  { symbol: "ADANIPORTS", name: "Adani Ports & SEZ", basePrice: 1500, vol: 0.3 },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement", basePrice: 12500, vol: 0.24 },
  { symbol: "GRASIM", name: "Grasim Industries", basePrice: 2800, vol: 0.24 },
  { symbol: "NESTLEIND", name: "Nestle India", basePrice: 2400, vol: 0.18 },
  { symbol: "BRITANNIA", name: "Britannia Industries", basePrice: 5600, vol: 0.2 },
  { symbol: "INDUSINDBK", name: "IndusInd Bank", basePrice: 1050, vol: 0.3 },
  { symbol: "BANDHANBNK", name: "Bandhan Bank", basePrice: 320, vol: 0.32 },
  { symbol: "PFC", name: "Power Finance Corp", basePrice: 460, vol: 0.3 },
  { symbol: "DLF", name: "DLF", basePrice: 750, vol: 0.28 },
  { symbol: "BEL", name: "Bharat Electronics", basePrice: 420, vol: 0.31 },
  { symbol: "HAL", name: "Hindustan Aeronautics", basePrice: 4800, vol: 0.33 },
  { symbol: "TATAPOWER", name: "Tata Power", basePrice: 400, vol: 0.3 },
  { symbol: "PNB", name: "Punjab National Bank", basePrice: 115, vol: 0.31 },
  { symbol: "CANBK", name: "Canara Bank", basePrice: 120, vol: 0.31 },
  { symbol: "DMART", name: "Avenue Supermarts", basePrice: 4200, vol: 0.26 },
  { symbol: "TRENT", name: "Trent", basePrice: 5300, vol: 0.32 },
  { symbol: "CIPLA", name: "Cipla", basePrice: 1500, vol: 0.22 },
  { symbol: "DRREDDY", name: "Dr Reddy's Labs", basePrice: 1250, vol: 0.23 },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", basePrice: 7500, vol: 0.25 },
  { symbol: "VEDL", name: "Vedanta", basePrice: 550, vol: 0.32 },
];

export const STOCK_MAP: Record<string, StockDef> = Object.fromEntries(
  STOCK_UNIVERSE.map((s) => [s.symbol, s]),
);

export function getStock(symbol: string): StockDef | undefined {
  return STOCK_MAP[symbol];
}

/** Symbols enabled out of the box on first run. */
export const DEFAULT_SCANNER_SYMBOLS = [
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "TCS",
  "SBIN",
  "AXISBANK",
  "TATAMOTORS",
  "BAJFINANCE",
  "BEL",
];

export function parseSymbolsCSV(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0 && STOCK_MAP[s] !== undefined);
}

// ---------- combined scan universe: indices + stocks ----------

export interface ScanAsset {
  symbol: string;
  name: string;
  kind: "INDEX" | "EQUITY";
  basePrice: number;
  vol: number; // annualised vol used by the paper walk
  exchange?: "NFO" | "BFO"; // index spot quote exchange (live)
}

export const SCAN_ASSETS: ScanAsset[] = [
  ...INSTRUMENT_LIST.map((i) => ({
    symbol: i.id,
    name: i.label,
    kind: "INDEX" as const,
    basePrice: i.basePrice,
    vol: i.iv,
    exchange: i.exchange,
  })),
  ...STOCK_UNIVERSE.map((s) => ({
    symbol: s.symbol,
    name: s.name,
    kind: "EQUITY" as const,
    basePrice: s.basePrice,
    vol: s.vol,
  })),
];

export const SCAN_ASSET_MAP: Record<string, ScanAsset> = Object.fromEntries(
  SCAN_ASSETS.map((a) => [a.symbol, a]),
);

export function getScanAsset(symbol: string): ScanAsset | undefined {
  return SCAN_ASSET_MAP[symbol];
}

/** CSV of enabled scanner symbols, validated against indices + stocks. */
export function parseScanSymbols(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0 && SCAN_ASSET_MAP[s] !== undefined);
}
