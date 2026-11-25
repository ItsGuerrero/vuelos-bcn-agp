import type { Airline, Direction } from "../types";
import { diffDays } from "./dates";

/**
 * Detector de ofertas flash.
 *
 * Dos detecciones independientes:
 *  1. Rebaja general (anomalía): en un mismo escaneo y para una aerolínea, un % significativo
 *     de las fechas (por defecto ≥ 25 %) cae más de un umbral (por defecto ≥ 20 %) respecto a
 *     su precio de referencia. Una sola fecha que baja mucho NO es una oferta (eso lo cubren
 *     los seguimientos).
 *  2. Precio chollo: cualquier trayecto por debajo de un precio fijo (por defecto 20 €).
 *
 * Referencia de cada fecha: mediana de los escaneos de los últimos 30 días para esa misma
 * fecha; si aún no hay suficientes, mediana de fechas parecidas (mismo día de la semana y
 * misma época, ±21 días). Durante el calentamiento (poco historial) solo funciona el chollo.
 */

export interface ScanPoint {
  direction: Direction;
  airline: Airline;
  date: string;
  price: number | null;
}

export interface BaselineRow {
  direction: Direction;
  airline: Airline;
  date: string;
  median: number;
  /** Nº de escaneos anteriores con precio para esa fecha. */
  n: number;
}

export interface Baseline {
  value: number;
  source: "same_date" | "similar";
}

export interface FlashSettings {
  enabledAnomaly: boolean;
  enabledThreshold: boolean;
  minDatesPct: number;
  minDropPct: number;
  thresholdPrice: number;
}

export const DEFAULT_FLASH_SETTINGS: FlashSettings = {
  enabledAnomaly: true,
  enabledThreshold: true,
  minDatesPct: 25,
  minDropPct: 20,
  thresholdPrice: 20,
};

/** Escaneos previos mínimos para fiarse de la mediana de una misma fecha. */
export const MIN_SAME_DATE_SAMPLES = 3;
/** Escaneos previos mínimos (por aerolínea) para activar la detección de anomalías. */
export const MIN_HISTORY_SCANS = 4;
/** Fechas con referencia mínimas para que el % de fechas rebajadas signifique algo. */
const MIN_ELIGIBLE_DATES = 10;
/** Nunca es una rebaja general con menos de estas fechas rebajadas. */
const MIN_DROPPED_DATES = 3;

export interface SaleItem {
  direction: Direction;
  date: string;
  price: number;
  baseline: number | null;
  dropPct: number | null;
}

export interface DetectedSale {
  kind: "anomaly" | "threshold";
  airline: Airline;
  /** null si afecta a los dos sentidos. */
  direction: Direction | null;
  items: SaleItem[];
  avgDropPct: number | null;
  minPrice: number;
  cheapest: Record<Direction, SaleItem[]>;
}

const key = (d: Direction, a: Airline, date: string) => `${d}|${a}|${date}`;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeBaselines(points: ScanPoint[], rows: BaselineRow[]): Map<string, Baseline> {
  const byKey = new Map(rows.map((r) => [key(r.direction, r.airline, r.date), r]));
  const out = new Map<string, Baseline>();
  for (const p of points) {
    const k = key(p.direction, p.airline, p.date);
    const same = byKey.get(k);
    if (same && same.n >= MIN_SAME_DATE_SAMPLES) {
      out.set(k, { value: same.median, source: "same_date" });
      continue;
    }
    const weekday = new Date(`${p.date}T12:00:00Z`).getUTCDay();
    const similar = rows
      .filter(
        (r) =>
          r.direction === p.direction &&
          r.airline === p.airline &&
          r.date !== p.date &&
          new Date(`${r.date}T12:00:00Z`).getUTCDay() === weekday &&
          Math.abs(diffDays(r.date, p.date)) <= 21,
      )
      .map((r) => r.median);
    const m = similar.length >= 2 ? median(similar) : null;
    if (m !== null) out.set(k, { value: m, source: "similar" });
  }
  return out;
}

/** ¿Seguimos en calentamiento para esta aerolínea? (pocos escaneos previos) */
export function inWarmup(rows: BaselineRow[], airline: Airline): boolean {
  const maxN = rows.filter((r) => r.airline === airline).reduce((m, r) => Math.max(m, r.n), 0);
  return maxN < MIN_HISTORY_SCANS;
}

function summarize(kind: DetectedSale["kind"], airline: Airline, items: SaleItem[]): DetectedSale {
  const dirs = new Set(items.map((i) => i.direction));
  const drops = items.map((i) => i.dropPct).filter((x): x is number => x !== null);
  const cheapestFor = (d: Direction) =>
    items
      .filter((i) => i.direction === d)
      .sort((a, b) => a.price - b.price || a.date.localeCompare(b.date))
      .slice(0, 5);
  return {
    kind,
    airline,
    direction: dirs.size === 1 ? [...dirs][0] : null,
    items: [...items].sort((a, b) => a.direction.localeCompare(b.direction) || a.date.localeCompare(b.date)),
    avgDropPct: drops.length ? Math.round((drops.reduce((s, x) => s + x, 0) / drops.length) * 10) / 10 : null,
    minPrice: Math.min(...items.map((i) => i.price)),
    cheapest: { "BCN-AGP": cheapestFor("BCN-AGP"), "AGP-BCN": cheapestFor("AGP-BCN") },
  };
}

export function detectFlashSales(input: {
  points: ScanPoint[];
  baselineRows: BaselineRow[];
  settings: FlashSettings;
}): { sales: DetectedSale[]; warmup: Record<Airline, boolean> } {
  const { points, baselineRows, settings } = input;
  const baselines = computeBaselines(points, baselineRows);
  const sales: DetectedSale[] = [];
  const warmup = { VY: inWarmup(baselineRows, "VY"), FR: inWarmup(baselineRows, "FR") };

  for (const airline of ["VY", "FR"] as Airline[]) {
    const pts = points.filter((p): p is ScanPoint & { price: number } => p.airline === airline && p.price !== null);
    const withBase = pts.map((p) => {
      const b = baselines.get(key(p.direction, p.airline, p.date)) ?? null;
      const dropPct = b ? Math.round(((b.value - p.price) / b.value) * 1000) / 10 : null;
      return { direction: p.direction, date: p.date, price: p.price, baseline: b?.value ?? null, dropPct };
    });

    if (settings.enabledAnomaly && !warmup[airline]) {
      const eligible = withBase.filter((x) => x.baseline !== null);
      const dropped = eligible.filter((x) => (x.dropPct ?? 0) >= settings.minDropPct);
      if (
        eligible.length >= MIN_ELIGIBLE_DATES &&
        dropped.length >= MIN_DROPPED_DATES &&
        (dropped.length / eligible.length) * 100 >= settings.minDatesPct
      ) {
        sales.push(summarize("anomaly", airline, dropped));
      }
    }

    if (settings.enabledThreshold) {
      const cheap = withBase.filter((x) => x.price <= settings.thresholdPrice);
      if (cheap.length) sales.push(summarize("threshold", airline, cheap));
    }
  }
  return { sales, warmup };
}

// ---------------------------------------------------------------------
// Anti-spam: no repetir el aviso de la misma oferta (misma aerolínea y fechas
// parecidas) en 48 h, salvo que el precio baje más.
// ---------------------------------------------------------------------
export interface LastFlashNotice {
  sentAt: string;
  airline: Airline;
  kind: DetectedSale["kind"];
  dates: string[]; // "BCN-AGP|2027-02-04"
  minPrice: number;
}

export const itemKeys = (s: Pick<DetectedSale, "items">) => s.items.map((i) => `${i.direction}|${i.date}`);

export function shouldNotifyFlash(
  sale: DetectedSale,
  previous: LastFlashNotice[],
  opts: { now?: Date; windowHours?: number; minExtraDropEur?: number } = {},
): boolean {
  const now = (opts.now ?? new Date()).getTime();
  const windowMs = (opts.windowHours ?? 48) * 3_600_000;
  const keys = new Set(itemKeys(sale));
  for (const p of previous) {
    if (p.airline !== sale.airline || p.kind !== sale.kind) continue;
    if (now - new Date(p.sentAt).getTime() > windowMs) continue;
    const overlap = p.dates.filter((d) => keys.has(d)).length;
    const similar = overlap / Math.max(1, Math.min(keys.size, p.dates.length)) >= 0.5;
    if (!similar) continue;
    // Misma oferta: solo se vuelve a avisar si el precio ha bajado más.
    if (sale.minPrice > p.minPrice - (opts.minExtraDropEur ?? 2)) return false;
  }
  return true;
}

/** Seguimientos activos afectados por la oferta (alguna de sus fechas, en su sentido). */
export function affectedTrackers<T extends { origin: string; destination: string; outbound_date: string; return_date: string | null; flex_days: number }>(
  sale: DetectedSale,
  trackers: T[],
): T[] {
  const keys = new Set(itemKeys(sale));
  const near = (dir: string, date: string, flex: number) => {
    for (let d = -flex; d <= flex; d++) {
      const x = new Date(`${date}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() + d);
      if (keys.has(`${dir}|${x.toISOString().slice(0, 10)}`)) return true;
    }
    return false;
  };
  return trackers.filter(
    (t) =>
      near(`${t.origin}-${t.destination}`, t.outbound_date, t.flex_days) ||
      (t.return_date !== null && near(`${t.destination}-${t.origin}`, t.return_date, t.flex_days)),
  );
}
