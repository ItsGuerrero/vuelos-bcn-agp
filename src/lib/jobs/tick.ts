import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nowInZone } from "../core/dates";
import { isScanHour } from "../core/schedule";
import { currentBudget, serpCallsPerScan } from "../server/services";
import { serverEnv } from "../server/env";
import { scanRoute } from "./scanRoute";
import { checkDueTrackers } from "./checkTrackers";
import { detectFlash } from "./detectFlash";
import { sendDailySummaries } from "./dailySummary";

/**
 * Se ejecuta cada hora (pg_cron → POST /api/jobs/tick).
 * Decide qué toca: escaneo de la ruta en las horas configuradas y
 * comprobación de los seguimientos cuya próxima comprobación ya ha llegado.
 */
export async function tick(db: SupabaseClient, force: { scan?: boolean; trackers?: boolean; detect?: boolean } = {}) {
  const z = nowInZone();

  // Ajustes de escaneo: la ruta es común, así que tomamos los de la primera pareja.
  const { data: s } = await db
    .from("settings")
    .select("flash_scan_times, flash_horizon_days")
    .limit(1)
    .maybeSingle();
  const scanTimes: string[] = s?.flash_scan_times ?? ["09:00", "21:00"];
  const horizonDays: number = s?.flash_horizon_days ?? 90;

  const out: Record<string, unknown> = { localTime: `${z.date} ${z.time}` };

  // ¿Ya se escaneó en los últimos 50 minutos? (evita duplicados si el cron se repite)
  const { data: recent } = await db
    .from("job_runs")
    .select("id")
    .eq("job", "scan_route")
    .in("status", ["ok", "partial"])
    .gte("started_at", new Date(Date.now() - 50 * 60_000).toISOString())
    .limit(1);

  const wantScan = force.scan || (isScanHour(z.hour, scanTimes) && !recent?.length);
  if (wantScan) {
    const budget = serverEnv.serpApiKey ? await currentBudget(db, scanTimes.length, horizonDays) : null;
    const includeVueling = Boolean(budget && budget.scansRemainingToday > 0);
    const scan = await scanRoute(db, { horizonDays, includeVueling });
    out.scan = scan;
    out.scanBudget = budget;
  }

  // Detector de ofertas: justo después de cada escaneo (o si se fuerza).
  if (wantScan || force.detect) {
    out.flash = await detectFlash(db);
  }

  if (force.trackers !== false) {
    const budget = serverEnv.serpApiKey ? await currentBudget(db, scanTimes.length, horizonDays) : null;
    // Reservamos las llamadas de los escaneos que quedan hoy.
    const detail = budget ? budget.detailCallsRemainingToday : 0;
    out.trackers = await checkDueTrackers(db, { detailCallsAvailable: detail });
    out.trackerBudget = budget;
  }

  // Resumen diario a las 9:00 (después de escanear y comprobar). El anti-duplicados evita repetirlo.
  if (z.hour === 9) out.dailySummary = await sendDailySummaries(db);

  out.callsPerScan = serpCallsPerScan(horizonDays);
  return out;
}
