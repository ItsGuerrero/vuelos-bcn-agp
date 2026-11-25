import type { Airline, Flight, TimeFilters, TimeWindow } from "../types";

/**
 * Mejor combinación de ida + vuelta.
 *
 * Las low-cost venden cada trayecto por separado, así que el precio de un
 * viaje de ida y vuelta es simplemente la suma de un vuelo de ida y uno de
 * vuelta, aunque sean de aerolíneas distintas.
 */

export interface Combo {
  outbound: Flight;
  return: Flight | null;
  /** Suma de tarifas × pasajeros. */
  baseTotal: number;
  /** baseTotal + equipaje habitual (por trayecto y pasajero). */
  totalWithBags: number;
  /** El total que se usa para ordenar (con o sin equipaje según el seguimiento). */
  total: number;
}

export interface ComboOptions {
  passengers: number;
  /** Coste del equipaje por trayecto y pasajero, por aerolínea. */
  baggage: Record<Airline, number>;
  withBaggage: boolean;
  timeFilters?: TimeFilters;
  /** Cuántas combinaciones devolver (la mejor + alternativas). Por defecto 4. */
  limit?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function passesWindow(depTime: string | null, w?: TimeWindow): boolean {
  if (!w || (!w.after && !w.before)) return true;
  // Sin hora (precio de calendario) no podemos garantizar el filtro.
  if (!depTime) return false;
  if (w.after && depTime < w.after) return false;
  if (w.before && depTime > w.before) return false;
  return true;
}

/** Si hay un vuelo concreto con hora, descarta el precio "de calendario" de esa aerolínea y día. */
export function dedupeCalendar(flights: Flight[]): Flight[] {
  const detailed = new Set(flights.filter((f) => !f.fromCalendar).map((f) => `${f.airline}|${f.date}`));
  return flights.filter((f) => !f.fromCalendar || !detailed.has(`${f.airline}|${f.date}`));
}

function legCost(f: Flight, opts: ComboOptions) {
  const base = f.price * opts.passengers;
  const bags = (opts.baggage[f.airline] ?? 0) * opts.passengers;
  return { base, withBags: base + bags };
}

export function bestCombinations(outbound: Flight[], ret: Flight[] | null, opts: ComboOptions): Combo[] {
  const limit = opts.limit ?? 4;
  const outs = dedupeCalendar(outbound).filter((f) => passesWindow(f.depTime, opts.timeFilters?.outbound));
  const rets = ret === null ? null : dedupeCalendar(ret).filter((f) => passesWindow(f.depTime, opts.timeFilters?.return));

  const combos: Combo[] = [];
  for (const o of outs) {
    const oc = legCost(o, opts);
    if (rets === null) {
      combos.push(makeCombo(o, null, oc.base, oc.withBags, opts.withBaggage));
      continue;
    }
    for (const r of rets) {
      if (r.date < o.date) continue;
      // Mismo día: la vuelta debe salir después de llegar la ida.
      if (r.date === o.date && o.arrTime && r.depTime && r.depTime <= o.arrTime) continue;
      const rc = legCost(r, opts);
      combos.push(makeCombo(o, r, oc.base + rc.base, oc.withBags + rc.withBags, opts.withBaggage));
    }
  }

  combos.sort((a, b) => a.total - b.total || a.baseTotal - b.baseTotal || comboKey(a).localeCompare(comboKey(b)));
  return combos.slice(0, limit);
}

function makeCombo(o: Flight, r: Flight | null, base: number, withBags: number, useBags: boolean): Combo {
  const baseTotal = round2(base);
  const totalWithBags = round2(withBags);
  return { outbound: o, return: r, baseTotal, totalWithBags, total: useBags ? totalWithBags : baseTotal };
}

export function comboKey(c: Combo): string {
  const f = (x: Flight | null) => (x ? `${x.airline}${x.flightNumber ?? "?"}@${x.date}T${x.depTime ?? "--"}` : "-");
  return `${f(c.outbound)}+${f(c.return)}`;
}

export interface DateMatrix {
  outboundDates: string[];
  returnDates: string[];
  /** cells[i][j] = mejor total para outboundDates[i] × returnDates[j] (null si no hay o la vuelta es antes). */
  cells: (number | null)[][];
  best: { outboundDate: string; returnDate: string; total: number } | null;
}

/** Matriz fecha de ida × fecha de vuelta con el mejor total de cada pareja de fechas. */
export function buildDateMatrix(
  outboundByDate: Record<string, Flight[]>,
  returnByDate: Record<string, Flight[]>,
  opts: ComboOptions,
): DateMatrix {
  const outboundDates = Object.keys(outboundByDate).sort();
  const returnDates = Object.keys(returnByDate).sort();
  let best: DateMatrix["best"] = null;
  const cells = outboundDates.map((od) =>
    returnDates.map((rd) => {
      if (rd < od) return null;
      const [c] = bestCombinations(outboundByDate[od], returnByDate[rd], { ...opts, limit: 1 });
      if (!c) return null;
      if (!best || c.total < best.total) best = { outboundDate: od, returnDate: rd, total: c.total };
      return c.total;
    }),
  );
  return { outboundDates, returnDates, cells, best };
}
