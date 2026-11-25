import { createAdminClient, isAuthorizedCron } from "@/lib/server/admin";
import { ryanair, serpApi } from "@/lib/server/services";
import { addDays, nowInZone } from "@/lib/core/dates";

export const maxDuration = 120;

/**
 * Prueba de humo de los proveedores desde el servidor real (Vercel).
 *   POST /api/jobs/smoke   Authorization: Bearer <CRON_SECRET>
 * Body: { "serpapi": true } para probar también SerpApi (gasta 2 búsquedas).
 * Sirve para comprobar que Ryanair no bloquea las IPs de Vercel y cuántos
 * días devuelve el calendario de Google en una sola llamada.
 */
export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { serpapi?: boolean };
  const today = nowInZone().date;
  const date = addDays(today, 21);
  const report: Record<string, unknown> = { today, testDate: date };

  const probe = async (name: string, fn: () => Promise<unknown[]>) => {
    const t0 = Date.now();
    try {
      const items = await fn();
      report[name] = { ok: true, ms: Date.now() - t0, count: items.length, sample: items.slice(0, 3) };
    } catch (e) {
      report[name] = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const fr = ryanair();
  await probe("ryanair_calendar_90d", async () =>
    (await fr.getCalendar("BCN", "AGP", today, addDays(today, 89), "FR")).filter((d) => d.price !== null),
  );
  await probe("ryanair_day", () => fr.searchOneWay("BCN", "AGP", date));

  if (body.serpapi) {
    const serp = serpApi(createAdminClient(), "manual");
    if (!serp) report.serpapi = { ok: false, error: "Falta SERPAPI_API_KEY" };
    else {
      await probe("serpapi_calendar_VY_90d", async () => {
        const days = await serp.getCalendar("BCN", "AGP", today, addDays(today, 89), "VY");
        report.serpapi_calendar_last_date = days.at(-1)?.date ?? null;
        return days.filter((d) => d.price !== null);
      });
      await probe("serpapi_day", async () => {
        const r = await serp.searchOneWayDetailed("BCN", "AGP", date, 1);
        report.serpapi_insights = r.insights;
        return r.flights;
      });
    }
  }
  return Response.json(report);
}
