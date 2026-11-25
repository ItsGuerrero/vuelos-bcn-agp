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

/** Precio habitual de un trayecto según nuestros escaneos (el más barato de las dos aerolíneas). */
export function scansTypical(direction: Direction, date: string, rows: BaselineRow[]): number | null {
  const pts: ScanPoint[] = (["VY", "FR"] as Airline[]).map((airline) => ({ direction, airline, date, price: 0 }));
  const b = computeBaselines(pts, rows);
  const vals = (["VY", "FR"] as Airline[])
    .map((a) => b.get(`${direction}|${a}|${date}`)?.value)
    .filter((v): v is number => typeof v === "number");
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

  // Precio habitual: Google (centro del rango típico) o, si no, la mediana de nuestros escaneos.
  let typical = 0;
  let allGoogle = true;
  let missing = false;
  const levels: string[] = [];
  const histories: Array<Array<[number, number]>> = [];
  for (const l of legs) {
    const ins = freshInsight(opts.insights, opts.previous, l.leg, l.f.date, 72, nowMs);
    if (ins?.priceLevel) levels.push(ins.priceLevel);
    if (ins?.priceHistory?.length) histories.push(ins.priceHistory);
    if (ins?.typicalPriceRange) {
      typical += (ins.typicalPriceRange[0] + ins.typicalPriceRange[1]) / 2;
      continue;
    }
    allGoogle = false;
    const s = scansTypical(l.dir, l.f.date, opts.baselineRows);
    if (s === null) missing = true;
    else typical += s;
  }

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
    typicalPerPerson: missing ? null : Math.round(typical * 100) / 100,
    typicalSource: missing ? null : allGoogle ? "google" : "scans",
    googleLevel: level,
    history,
    activeFlashSale: opts.activeFlashSale,
  };
}
