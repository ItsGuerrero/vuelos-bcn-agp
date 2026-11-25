import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nowInZone } from "../core/dates";
import { dailySummaryMessage, type SummaryTrip } from "../notify/messages";
import { notify } from "../notify/notifier";
import { appUrl } from "../server/env";

/** Resumen diario (opcional, en Ajustes): estado de los viajes y ofertas activas. Se envía a las 9:00. */
export async function sendDailySummaries(db: SupabaseClient) {
  const { data: couples } = await db.from("settings").select("couple_id").eq("daily_summary", true);
  const out: Array<Record<string, unknown>> = [];
  const today = nowInZone().date;

  for (const { couple_id } of couples ?? []) {
    const { data: trackers } = await db
      .from("trackers")
      .select("id, origin, destination, outbound_date, return_date, lowest_price, with_baggage")
      .eq("couple_id", couple_id)
      .eq("status", "active")
      .order("outbound_date");
    const trips: SummaryTrip[] = [];
    for (const t of trackers ?? []) {
      const { data: checks } = await db
        .from("price_checks")
        .select("checked_at, best_total, best_total_bags, prediction")
        .eq("tracker_id", t.id)
        .order("checked_at", { ascending: false })
        .limit(2);
      const total = (c?: { best_total: number | null; best_total_bags: number | null }) =>
        c ? Number(t.with_baggage ? c.best_total_bags : c.best_total) : null;
      trips.push({
        ...t,
        current: total(checks?.[0]),
        previous: total(checks?.[1]),
        lowest: t.lowest_price === null ? null : Number(t.lowest_price),
        recommendation: checks?.[0]?.prediction?.recommendation ?? null,
      });
    }
    const { count } = await db
      .from("flash_sales")
      .select("id", { count: "exact", head: true })
      .eq("couple_id", couple_id)
      .eq("status", "active");
    const message = dailySummaryMessage({ trips, activeSales: count ?? 0, appUrl: appUrl() });
    const r = await notify(db, {
      coupleId: couple_id,
      type: "daily_summary",
      message,
      travelerId: null,
      dedupeKey: `daily:${today}`,
      dedupeHours: 20,
    }).catch((e) => ({ sent: 0, skipped: String(e) }));
    out.push({ couple: couple_id, ...r });
  }
  return out;
}
