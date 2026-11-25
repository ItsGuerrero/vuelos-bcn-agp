import type { Combo } from "./combos";
import { computeBaselines, type BaselineRow, type ScanPoint } from "./flash";
import type { PredictionInput } from "./predict";
import type { Airline, Airport, Direction, PriceInsights } from "../types";

/** price_insights de Google guardado junto a la fecha del trayecto al que corresponde. */
export type StoredInsights = PriceInsights & { date: string };
export type LegInsights = Partial<Record<"outbound" | "return", StoredInsights | null>>;

export interface PrevCheck {
  checked_at: string;
  best_total: number | null;
  insights: LegInsights | null;
}

/** Último price_insights de un trayecto y fecha concretos, si no tiene más de `maxHours`. */
export function freshInsight(
  current: LegInsights,
  previous: PrevCheck[],
  leg: "outbound" | "return",
  date: string,
  maxHours: number,
  nowMs = Date.now(),
): StoredInsights | null {
  const now = current[leg];
  if (now && now.date === date) return now;
  for (let i = previous.length - 1; i >= 0; i--) {
    const p = previous[i];
    const x = p.insights?.[leg];
    if (!x || x.date !== date) continue;
    if (nowMs - Date.parse(p.checked_at) > maxHours * 3_600_000) return null;
    return x;
  }
  return null;
}

/**
 * Precio habitual de un trayecto según nuestros escaneos (el más barato de las dos aerolíneas).
 * Para la predicción solo vale la referencia de la MISMA fecha: las "fechas parecidas" engañan
 * en festivos (p. ej. el 7 de enero no se parece a los demás jueves de enero).
 */
export function scansTypical(direction: Direction, date: string, rows: BaselineRow[], sameDateOnly = true): number | null {
  const pts: ScanPoint[] = (["VY", "FR"] as Airline[]).map((airline) => ({ direction, airline, date, price: 0 }));
  const b = computeBaselines(pts, rows);
  const vals = (["VY", "FR"] as Airline[])
    .map((a) => b.get(`${direction}|${a}|${date}`))
    .filter((v) => v && (!sameDateOnly || v.source === "same_date"))
    .map((v) => v!.value);
  return vals.length ? Math.min(...vals) : null;
}

export function buildPredictionInput(opts: {
  today: string;
  tracker: { origin: Airport; destination: Airport; outbound_date: string; return_date: string | null; passengers: number };
  best: Combo;
  insights: LegInsights;
  previous: PrevCheck[];
  baselineRows: BaselineRow[];
  activeFlashSale: string | null;
  nowMs?: number;
}): PredictionInput {
  const { tracker: t, best } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const legs = [
    { leg: "outbound" as const, f: best.outbound, dir: `${t.origin}-${t.destination}` as Direction },
    ...(best.return ? [{ leg: "return" as const, f: best.return, dir: `${t.destination}-${t.origin}` as Direction }] : []),
  ];

  // Precio habitual: Google (centro del rango típico) o, si no, la mediana de nuestros escaneos
  // de esa misma fecha. Solo se comparan los trayectos de los que hay referencia.
  let typical = 0;
  let comparable = 0;
  let fromGoogle = 0;
  let fromScans = 0;
  const covered: string[] = [];
  const levels: string[] = [];
  const histories: Array<Array<[number, number]>> = [];
  for (const l of legs) {
    const ins = freshInsight(opts.insights, opts.previous, l.leg, l.f.date, 72, nowMs);
    if (ins?.priceLevel) levels.push(ins.priceLevel);
    if (ins?.priceHistory?.length) histories.push(ins.priceHistory);
    let ref: number | null = null;
    if (ins?.typicalPriceRange) {
      ref = (ins.typicalPriceRange[0] + ins.typicalPriceRange[1]) / 2;
      fromGoogle++;
    } else {
      ref = scansTypical(l.dir, l.f.date, opts.baselineRows);
      if (ref !== null) fromScans++;
    }
    if (ref === null) continue;
    typical += ref;
    comparable += l.f.price;
    covered.push(l.leg);
  }
  const partial = covered.length > 0 && covered.length < legs.length;
  const typicalSource = !covered.length ? null : fromScans === 0 ? "google" : fromGoogle === 0 ? "scans" : "mixed";

  // Histórico: el nuestro (por persona) y, si aún es corto, el price_history de Google.
  let history = opts.previous
    .filter((p) => p.best_total !== null)
    .map((p) => ({ t: Date.parse(p.checked_at), total: Number(p.best_total) / t.passengers }));
  history.push({ t: nowMs, total: best.baseTotal / t.passengers });
  const recentOwn = history.filter((h) => nowMs - h.t <= 7 * 86_400_000);
  if (recentOwn.length < 3 && histories.length === legs.length) {
    const sums = new Map<number, number[]>();
    for (const h of histories) for (const [ts, price] of h) sums.set(ts, [...(sums.get(ts) ?? []), price]);
    history = [...sums.entries()]
      .filter(([, prices]) => prices.length === legs.length)
      .map(([ts, prices]) => ({ t: ts * 1000, total: prices.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => a.t - b.t);
  }

  const level = levels.length === legs.length && new Set(levels).size === 1 ? levels[0] : null;

  return {
    today: opts.today,
    outboundDate: best.outbound.date,
    tripDates: legs.map((l) => l.f.date),
    currentPerPerson: legs.reduce((s, l) => s + l.f.price, 0),
    typicalPerPerson: covered.length ? Math.round(typical * 100) / 100 : null,
    comparablePerPerson: covered.length ? Math.round(comparable * 100) / 100 : undefined,
    typicalScope: partial ? (covered[0] === "outbound" ? "la ida" : "la vuelta") : undefined,
    typicalSource,
    googleLevel: level,
    history,
    activeFlashSale: opts.activeFlashSale,
  };
}
