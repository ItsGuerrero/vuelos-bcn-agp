import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Airport, DayPrice, Direction } from "../types";
import { addDays, nowInZone } from "../core/dates";
import { ryanair, serpApi, startJob } from "../server/services";

/**
 * Escaneo diario de la ruta: precio más barato de cada día, en ambos sentidos,
 * para los próximos N días y por aerolínea. Fase 1: solo guarda datos.
 *  - Ryanair: calendario de tarifas público (no gasta SerpApi).
 *  - Vueling: google_flights_calendar de SerpApi (1 llamada por sentido).
 */
export interface ScanOptions {
  horizonDays: number;
  includeVueling: boolean;
}

const DIRECTIONS: Array<{ dir: Direction; origin: Airport; dest: Airport }> = [
  { dir: "BCN-AGP", origin: "BCN", dest: "AGP" },
  { dir: "AGP-BCN", origin: "AGP", dest: "BCN" },
];

export async function scanRoute(db: SupabaseClient, opts: ScanOptions) {
  const job = await startJob(db, "scan_route");
  const scanId = crypto.randomUUID();
  const from = nowInZone().date;
  const to = addDays(from, opts.horizonDays - 1);
  const fr = ryanair();
  const serp = opts.includeVueling ? serpApi(db, "flash") : null;
  const counts: Record<string, number> = {};

  for (const { dir, origin, dest } of DIRECTIONS) {
    const sources: Array<{ key: string; run: () => Promise<DayPrice[]> }> = [
      { key: `FR ${dir}`, run: () => fr.getCalendar(origin, dest, from, to, "FR") },
    ];
    if (serp) sources.push({ key: `VY ${dir}`, run: () => serp.getCalendar(origin, dest, from, to, "VY") });

    for (const s of sources) {
      try {
        const days = await s.run();
        counts[s.key] = days.filter((d) => d.price !== null).length;
        if (!days.length) continue;
        const rows = days.map((d) => ({
          scan_id: scanId,
          direction: dir,
          airline: d.airline,
          flight_date: d.date,
          min_price: d.price,
          provider: d.provider,
        }));
        const { error } = await db.from("route_scans").insert(rows);
        if (error) throw new Error(`route_scans: ${error.message}`);
      } catch (e) {
        job.logError(s.key, e);
      }
    }
  }

  const failed = Object.keys(counts).length === 0;
  const status = await job.finish({ scanId, from, to, daysWithPrice: counts, vueling: Boolean(serp) }, failed);
  return { status, scanId, counts, errors: job.errors };
}
