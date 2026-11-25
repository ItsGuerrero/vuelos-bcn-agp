import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Airline, Airport, BaggageByAirline, Flight, TimeFilters } from "../types";
import { addDays, nowInZone } from "../core/dates";
import { bestCombinations, buildDateMatrix, type Combo, type ComboOptions } from "../core/combos";
import { evaluateNewLow } from "../core/newLow";
import { evaluateTarget } from "../core/target";
import { newLowMessage, riseRiskMessage, targetPriceMessage } from "../notify/messages";
import { predict, predictionLine, type Prediction } from "../core/predict";
import { buildPredictionInput, freshInsight, type LegInsights, type PrevCheck } from "../core/predictionInputs";
import type { BaselineRow } from "../core/flash";
import { AEROLINEA } from "../format";
import { loadRouteData } from "./detectFlash";
import { notify } from "../notify/notifier";
import { appUrl } from "../server/env";
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
  traveler_id: string | null;
  target_price: number | null;
  target_notified_price: number | null;
  muted_until: string | null;
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

  // Datos para la predicción: referencias de la ruta (una vez por ejecución) y ofertas activas.
  let baselineRows: BaselineRow[] | null = null;
  const getBaselines = async () => {
    if (baselineRows === null) baselineRows = await loadRouteData(db).then((r) => r.baselineRows).catch(() => []);
    return baselineRows;
  };
  const { data: activeSales } = await db
    .from("flash_sales")
    .select("couple_id, airline, items")
    .eq("status", "active")
    .in("couple_id", coupleIds);

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
      const { data: prevData } = await db
        .from("price_checks")
        .select("checked_at, best_total, insights")
        .eq("tracker_id", t.id)
        .gte("checked_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
        .order("checked_at");
      const previous = (prevData ?? []) as PrevCheck[];

      for (const l of legs) {
        const vy = await vuelingFromScans(db, l.origin, l.dest, l.dates).catch((e) => {
          errors.push({ where: `VY scans ${l.leg}`, message: String(e) });
          return {} as Record<string, Flight | null>;
        });
        for (const date of l.dates) {
          const list: Flight[] = [];
          try {
            const window = t.time_filters?.[l.leg];
            const wKey = window ? `:${window.after ?? ""}-${window.before ?? ""}` : "";
            const flights = await cached(db, `ryanair:day:${l.origin}-${l.dest}:${date}${wKey}`, "ryanair", 60, () =>
              fr.searchOneWay(l.origin, l.dest, date, 1, { window }),
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

      // Búsquedas de detalle con SerpApi (presupuesto limitado), por prioridad:
      //  1. la mejor combinación usa un precio de calendario de Vueling (sin hora ni número de vuelo);
      //  2. hay filtro horario (los precios de calendario no lo garantizan);
      //  3. falta un price_insights reciente (< 24 h) de un trayecto de la mejor combinación.
      // Sin filtro de aerolínea: así Google devuelve price_insights (el parser ya se queda con VY y FR directos).
      const insights: LegInsights = {};
      if (serp && detailLeft > 0) {
        const done = new Set<string>();
        const runDetail = async (leg: "outbound" | "return", date: string) => {
          const k = `${leg}|${date}`;
          if (done.has(k) || detailLeft <= 0) return;
          done.add(k);
          const l = legs.find((x) => x.leg === leg)!;
          try {
            detailLeft--;
            const r = await serp.searchOneWayDetailed(l.origin, l.dest, date, 1, { airlines: null, nonstop: true });
            const vyDetailed = r.flights.filter((f) => f.airline === "VY");
            byLeg[leg][date] = [...(byLeg[leg][date] ?? []), ...vyDetailed];
            insights[leg] = r.insights ? { ...r.insights, date } : null;
            providers.add("serpapi");
          } catch (e) {
            errors.push({ where: `SerpApi detalle ${leg} ${date}`, message: e instanceof Error ? e.message : String(e) });
          }
        };

        let best = combos[0];
        if (best?.outbound.fromCalendar) await runDetail("outbound", best.outbound.date);
        if (best?.return?.fromCalendar) await runDetail("return", best.return.date);
        if (!done.size && (t.time_filters?.outbound || t.time_filters?.return)) {
          await runDetail("outbound", t.outbound_date);
          if (t.return_date) await runDetail("return", t.return_date);
        }
        if (done.size) combos = combosFor();
        best = combos[0];
        if (best) {
          const legsOfBest = [
            { leg: "outbound" as const, date: best.outbound.date },
            ...(best.return ? [{ leg: "return" as const, date: best.return.date }] : []),
          ];
          for (const x of legsOfBest) {
            if (!freshInsight(insights, previous, x.leg, x.date, 24)) await runDetail(x.leg, x.date);
          }
          combos = combosFor();
        }
      }

      const matrix =
        t.flex_days > 0 && t.return_date ? buildDateMatrix(byLeg.outbound, byLeg.return, comboOpts) : null;
      const best = combos[0] ?? null;

      // Predicción "¿bajará?" (heurística transparente).
      let prediction: Prediction | null = null;
      if (best) {
        const comboKeys = [
          `${t.origin}-${t.destination}|${best.outbound.date}`,
          ...(best.return ? [`${t.destination}-${t.origin}|${best.return.date}`] : []),
        ];
        const sale = (activeSales ?? []).find(
          (x) =>
            x.couple_id === t.couple_id &&
            (x.items as Array<{ direction: string; date: string }>).some((i) => comboKeys.includes(`${i.direction}|${i.date}`)),
        );
        prediction = predict(
          buildPredictionInput({
            today,
            tracker: t,
            best,
            insights,
            previous,
            baselineRows: await getBaselines(),
            activeFlashSale: sale ? AEROLINEA[sale.airline as Airline] : null,
          }),
        );
      }

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
          prediction,
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
      let sentType: string | null = null;
      if (best) {
        newLow = evaluateNewLow({
          price: best.total,
          lowest: t.lowest_price === null ? null : Number(t.lowest_price),
          notifiedLow: t.notified_low === null ? null : Number(t.notified_low),
          firstPrice: t.first_price === null ? null : Number(t.first_price),
          minDropEur: Number(s?.new_low_min_drop_eur ?? 5),
          minDropPct: Number(s?.new_low_min_drop_pct ?? 3),
        });
        const target = evaluateTarget({
          price: best.total,
          target: t.target_price === null ? null : Number(t.target_price),
          notifiedPrice: t.target_notified_price === null ? null : Number(t.target_notified_price),
          minDropEur: Number(s?.new_low_min_drop_eur ?? 5),
        });
        update.lowest_price = newLow.lowest;
        if (newLow.isHistoricLow) update.lowest_price_at = new Date().toISOString();
        if (t.first_price === null) update.first_price = best.total;
        update.notified_low = newLow.notifiedLow;
        update.target_notified_price = target.notifiedPrice;

        // Avisos (si el seguimiento no está silenciado). Si coinciden los dos, se manda solo el de objetivo.
        const muted = t.muted_until !== null && new Date(t.muted_until) > new Date();
        const info = { ...t, target_price: t.target_price === null ? null : Number(t.target_price) };
        const predLine = prediction ? predictionLine(prediction) : undefined;
        // Riesgo de subida: estamos cerca del mínimo y la estimación dice que no va a bajar.
        const riseRisk =
          !newLow.isFirstCheck &&
          prediction !== null &&
          prediction.recommendation === "Comprar ya" &&
          prediction.probability <= 25 &&
          best.total <= newLow.lowest * 1.05;
        const message = target.notify
          ? targetPriceMessage({ tracker: info, combo: best, total: best.total, isNewLow: newLow.isHistoricLow && !newLow.isFirstCheck, appUrl: appUrl(), prediction: predLine })
          : newLow.notify
            ? newLowMessage({ tracker: info, combo: best, total: best.total, drop: newLow.drop, appUrl: appUrl(), prediction: predLine })
            : riseRisk && prediction
              ? riseRiskMessage({ tracker: info, combo: best, total: best.total, lowest: newLow.lowest, appUrl: appUrl(), prediction })
              : null;
        if (message && !muted) {
          const type = target.notify ? "target_price" : newLow.notify ? "new_low" : "rise_risk";
          try {
            await notify(db, {
              coupleId: t.couple_id,
              type,
              message,
              travelerId: t.traveler_id,
              trackerId: t.id,
              // El riesgo de subida se avisa como mucho una vez cada 3 días por seguimiento.
              dedupeKey: type === "rise_risk" ? `rise_risk:${t.id}` : `${type}:${t.id}:${best.total}`,
              dedupeHours: type === "rise_risk" ? 72 : 48,
              payload: { total: best.total, drop: newLow.drop },
            });
            sentType = type;
          } catch (e) {
            errors.push({ where: `aviso ${type}`, message: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      await db.from("trackers").update(update).eq("id", t.id);

      results.push({ tracker: t.id, best: best?.total ?? null, notified: sentType, errors: errors.length });
      for (const e of errors) job.logError(`${t.id} ${e.where}`, e.message);
    } catch (e) {
      job.logError(`tracker ${t.id}`, e);
    }
  }

  await job.finish({ checked: results.length, results, detailCallsUsed: opts.detailCallsAvailable - detailLeft });
  return { checked: results.length, results, errors: job.errors };
}
