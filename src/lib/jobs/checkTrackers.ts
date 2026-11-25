import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Airline, Airport, BaggageByAirline, Flight, PriceInsights, TimeFilters } from "../types";
import { addDays, nowInZone } from "../core/dates";
import { bestCombinations, buildDateMatrix, type Combo, type ComboOptions } from "../core/combos";
import { evaluateNewLow } from "../core/newLow";
import { isExpired, nextCheckAt } from "../core/schedule";
import { cached, ryanair, serpApi, startJob } from "../server/services";

interface TrackerRow {
  id: string;
  couple_id: string;
  origin: Airport;
  destination: Airport;
  outbound_date: string;
  return_date: string | null;
  flex_days: number;
  passengers: number;
  time_filters: TimeFilters;
  with_baggage: boolean;
  check_interval_hours: number | null;
  lowest_price: number | null;
  first_price: number | null;
  notified_low: number | null;
}

interface SettingsRow {
  couple_id: string;
  baggage_by_airline: BaggageByAirline;
  new_low_min_drop_eur: number;
  new_low_min_drop_pct: number;
}

const flexDates = (center: string, flex: number, today: string) => {
  const out: string[] = [];
  for (let d = -flex; d <= flex; d++) {
    const x = addDays(center, d);
    if (x >= today) out.push(x);
  }
  return out;
};

/** Último precio de calendario de Vueling para cada fecha (del escaneo de la ruta). */
async function vuelingFromScans(db: SupabaseClient, origin: Airport, dest: Airport, dates: string[]) {
  const out: Record<string, Flight | null> = {};
  if (!dates.length) return out;
  const { data, error } = await db
    .from("route_scans")
    .select("flight_date, min_price, scanned_at")
    .eq("direction", `${origin}-${dest}`)
    .eq("airline", "VY")
    .in("flight_date", dates)
    .gte("scanned_at", new Date(Date.now() - 36 * 3_600_000).toISOString())
    .order("scanned_at", { ascending: false });
  if (error) throw new Error(`route_scans: ${error.message}`);
  for (const r of data ?? []) {
    if (r.flight_date in out) continue;
    out[r.flight_date] =
      r.min_price === null
        ? null
        : {
            airline: "VY",
            flightNumber: null,
            date: r.flight_date,
            depTime: null,
            arrTime: null,
            price: Number(r.min_price),
            currency: "EUR",
            provider: "serpapi-calendar",
            fromCalendar: true,
          };
  }
  return out;
}

export async function checkDueTrackers(db: SupabaseClient, opts: { maxTrackers?: number; detailCallsAvailable: number; trackerId?: string }) {
  const job = await startJob(db, "check_trackers");
  const today = nowInZone().date;
  let detailLeft = opts.detailCallsAvailable;

  let q = db.from("trackers").select("*").eq("status", "active");
  q = opts.trackerId ? q.eq("id", opts.trackerId) : q.lte("next_check_at", new Date().toISOString());
  const { data: trackers, error } = await q.order("next_check_at").limit(opts.maxTrackers ?? 10);
  if (error) {
    job.logError("select trackers", error.message);
    await job.finish({}, true);
    return { checked: 0, errors: job.errors };
  }

  const coupleIds = [...new Set((trackers ?? []).map((t) => t.couple_id))];
  const { data: settingsRows } = await db.from("settings").select("*").in("couple_id", coupleIds);
  const settingsBy = new Map((settingsRows ?? []).map((s: SettingsRow) => [s.couple_id, s]));
  const fr = ryanair();
  const serp = serpApi(db, "trackers");
  const results: Array<Record<string, unknown>> = [];

  for (const t of (trackers ?? []) as TrackerRow[]) {
    try {
      if (isExpired(today, t.outbound_date)) {
        await db.from("trackers").update({ status: "expired" }).eq("id", t.id);
        results.push({ tracker: t.id, expired: true });
        continue;
      }
      const s = settingsBy.get(t.couple_id);
      const baggage: Record<Airline, number> = {
        VY: Number(s?.baggage_by_airline?.VY?.price ?? 0),
        FR: Number(s?.baggage_by_airline?.FR?.price ?? 0),
      };
      const comboOpts: ComboOptions = {
        passengers: t.passengers,
        baggage,
        withBaggage: t.with_baggage,
        timeFilters: t.time_filters,
      };

      const legs = [
        { leg: "outbound" as const, origin: t.origin, dest: t.destination, dates: flexDates(t.outbound_date, t.flex_days, today) },
        ...(t.return_date
          ? [{ leg: "return" as const, origin: t.destination, dest: t.origin, dates: flexDates(t.return_date, t.flex_days, today) }]
          : []),
      ];

      const byLeg: Record<"outbound" | "return", Record<string, Flight[]>> = { outbound: {}, return: {} };
      const providers = new Set<string>();
      const errors: Array<{ where: string; message: string }> = [];

      for (const l of legs) {
        const vy = await vuelingFromScans(db, l.origin, l.dest, l.dates).catch((e) => {
          errors.push({ where: `VY scans ${l.leg}`, message: String(e) });
          return {} as Record<string, Flight | null>;
        });
        for (const date of l.dates) {
          const list: Flight[] = [];
          try {
            const flights = await cached(db, `ryanair:avail:${l.origin}-${l.dest}:${date}`, "ryanair", 60, () =>
              fr.searchOneWay(l.origin, l.dest, date),
            );
            list.push(...flights);
            providers.add("ryanair");
          } catch (e) {
            errors.push({ where: `FR ${l.leg} ${date}`, message: e instanceof Error ? e.message : String(e) });
          }
          if (vy[date]) {
            list.push(vy[date]!);
            providers.add("serpapi-calendar");
          }
          byLeg[l.leg][date] = list;
        }
      }

      const combosFor = () => {
        const outAll = Object.values(byLeg.outbound).flat();
        const retAll = t.return_date ? Object.values(byLeg.return).flat() : null;
        return bestCombinations(outAll, retAll, comboOpts);
      };
      let combos: Combo[] = combosFor();

      // Búsqueda de detalle con SerpApi solo si la mejor combinación usa un precio
      // de calendario de Vueling (sin hora ni número de vuelo) o hay filtro horario.
      const insights: Partial<Record<"outbound" | "return", PriceInsights | null>> = {};
      if (serp && detailLeft > 0) {
        const best = combos[0];
        const targets: Array<{ leg: "outbound" | "return"; date: string }> = [];
        if (best?.outbound.fromCalendar) targets.push({ leg: "outbound", date: best.outbound.date });
        if (best?.return?.fromCalendar) targets.push({ leg: "return", date: best.return.date });
        // Con filtro horario los precios de calendario se descartan: miramos Vueling en las fechas centrales.
        const hasFilters = Boolean(t.time_filters?.outbound || t.time_filters?.return);
        if (!targets.length && hasFilters) {
          targets.push({ leg: "outbound", date: t.outbound_date });
          if (t.return_date) targets.push({ leg: "return", date: t.return_date });
        }
        for (const target of targets) {
          if (detailLeft <= 0) break;
          const l = legs.find((x) => x.leg === target.leg)!;
          try {
            detailLeft--;
            const r = await serp.searchOneWayDetailed(l.origin, l.dest, target.date, 1);
            // Añadimos los vuelos de Vueling con detalle (Ryanair ya lo tenemos de su web).
            const vyDetailed = r.flights.filter((f) => f.airline === "VY");
            byLeg[target.leg][target.date] = [...(byLeg[target.leg][target.date] ?? []), ...vyDetailed];
            insights[target.leg] = r.insights;
            providers.add("serpapi");
          } catch (e) {
            errors.push({ where: `SerpApi detalle ${target.leg} ${target.date}`, message: e instanceof Error ? e.message : String(e) });
          }
        }
        if (targets.length) combos = combosFor();
      }

      const matrix =
        t.flex_days > 0 && t.return_date ? buildDateMatrix(byLeg.outbound, byLeg.return, comboOpts) : null;
      const best = combos[0] ?? null;

      const { data: check, error: checkErr } = await db
        .from("price_checks")
        .insert({
          tracker_id: t.id,
          providers: [...providers],
          best_total: best?.baseTotal ?? null,
          best_total_bags: best?.totalWithBags ?? null,
          best_combo: best,
          alternatives: combos.slice(1, 4),
          date_matrix: matrix,
          insights: Object.keys(insights).length ? insights : null,
          errors: errors.length ? errors : null,
        })
        .select("id")
        .single();
      if (checkErr) throw new Error(`price_checks: ${checkErr.message}`);

      const quoteRows = (["outbound", "return"] as const).flatMap((leg) =>
        Object.values(byLeg[leg])
          .flat()
          .map((f) => ({
            check_id: check.id,
            direction: leg,
            flight_date: f.date,
            airline: f.airline,
            flight_number: f.flightNumber,
            dep_time: f.depTime,
            arr_time: f.arrTime,
            price: f.price,
            provider: f.provider,
          })),
      );
      if (quoteRows.length) await db.from("flight_quotes").insert(quoteRows);

      const update: Record<string, unknown> = {
        last_checked_at: new Date().toISOString(),
        next_check_at: nextCheckAt({ today, outboundDate: t.outbound_date, customIntervalHours: t.check_interval_hours }).toISOString(),
      };
      let newLow = null;
      if (best) {
        newLow = evaluateNewLow({
          price: best.total,
          lowest: t.lowest_price === null ? null : Number(t.lowest_price),
          notifiedLow: t.notified_low === null ? null : Number(t.notified_low),
          firstPrice: t.first_price === null ? null : Number(t.first_price),
          minDropEur: Number(s?.new_low_min_drop_eur ?? 5),
          minDropPct: Number(s?.new_low_min_drop_pct ?? 3),
        });
        update.lowest_price = newLow.lowest;
        if (newLow.isHistoricLow) update.lowest_price_at = new Date().toISOString();
        if (t.first_price === null) update.first_price = best.total;
        // Fase 3: aquí se enviará el aviso de Telegram cuando newLow.notify sea true.
        update.notified_low = newLow.notifiedLow;
      }
      await db.from("trackers").update(update).eq("id", t.id);

      results.push({ tracker: t.id, best: best?.total ?? null, newLow: newLow?.notify ?? false, errors: errors.length });
      for (const e of errors) job.logError(`${t.id} ${e.where}`, e.message);
    } catch (e) {
      job.logError(`tracker ${t.id}`, e);
    }
  }

  await job.finish({ checked: results.length, results, detailCallsUsed: opts.detailCallsAvailable - detailLeft });
  return { checked: results.length, results, errors: job.errors };
}
