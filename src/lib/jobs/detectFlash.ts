import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Airline, Direction } from "../types";
import {
  affectedTrackers,
  detectFlashSales,
  itemKeys,
  shouldNotifyFlash,
  type BaselineRow,
  type DetectedSale,
  type FlashSettings,
  type LastFlashNotice,
  type ScanPoint,
} from "../core/flash";
import { flashSaleMessage } from "../notify/messages";
import { notify } from "../notify/notifier";
import { appUrl } from "../server/env";
import { startJob } from "../server/services";

interface SettingsRow {
  couple_id: string;
  flash_enabled_anomaly: boolean;
  flash_enabled_threshold: boolean;
  flash_min_dates_pct: number;
  flash_min_drop_pct: number;
  flash_threshold_price: number;
  flash_muted_until: string | null;
}

export async function loadRouteData(db: SupabaseClient): Promise<{ points: ScanPoint[]; baselineRows: BaselineRow[] }> {
  const [latest, base] = await Promise.all([db.rpc("route_latest_prices"), db.rpc("route_baselines", { p_days: 30 })]);
  if (latest.error) throw new Error(`route_latest_prices: ${latest.error.message}`);
  if (base.error) throw new Error(`route_baselines: ${base.error.message}`);
  const points: ScanPoint[] = (latest.data ?? []).map((r: { direction: Direction; airline: Airline; flight_date: string; min_price: number | null }) => ({
    direction: r.direction,
    airline: r.airline,
    date: r.flight_date,
    price: r.min_price === null ? null : Number(r.min_price),
  }));
  const baselineRows: BaselineRow[] = (base.data ?? []).map((r: { direction: Direction; airline: Airline; flight_date: string; median: number; n: number }) => ({
    direction: r.direction,
    airline: r.airline,
    date: r.flight_date,
    median: Number(r.median),
    n: r.n,
  }));
  return { points, baselineRows };
}

export function toFlashSettings(s: SettingsRow): FlashSettings {
  return {
    enabledAnomaly: s.flash_enabled_anomaly,
    enabledThreshold: s.flash_enabled_threshold,
    minDatesPct: Number(s.flash_min_dates_pct),
    minDropPct: Number(s.flash_min_drop_pct),
    thresholdPrice: Number(s.flash_threshold_price),
  };
}

/** Detecta ofertas tras cada escaneo, actualiza su ciclo de vida y avisa por Telegram. */
export async function detectFlash(db: SupabaseClient) {
  const job = await startJob(db, "detect_flash");
  const summary: Record<string, unknown>[] = [];
  try {
    const { points, baselineRows } = await loadRouteData(db);
    const { data: allSettings } = await db.from("settings").select("*");

    for (const s of (allSettings ?? []) as SettingsRow[]) {
      const settings = toFlashSettings(s);
      const { sales, warmup } = detectFlashSales({ points, baselineRows, settings });

      const { data: active } = await db.from("flash_sales").select("*").eq("couple_id", s.couple_id).eq("status", "active");
      const { data: trackers } = await db
        .from("trackers")
        .select("id, origin, destination, outbound_date, return_date, flex_days")
        .eq("couple_id", s.couple_id)
        .eq("status", "active");
      const { data: recent } = await db
        .from("notifications")
        .select("sent_at, payload")
        .eq("couple_id", s.couple_id)
        .eq("type", "flash_sale")
        .gte("sent_at", new Date(Date.now() - 48 * 3_600_000).toISOString());
      const previous: LastFlashNotice[] = (recent ?? []).map((n) => ({
        sentAt: n.sent_at,
        airline: n.payload.airline,
        kind: n.payload.kind,
        dates: n.payload.dates ?? [],
        minPrice: Number(n.payload.minPrice),
      }));
      const muted = s.flash_muted_until !== null && new Date(s.flash_muted_until) > new Date();

      const seen = new Set<string>();
      for (const sale of sales) {
        const existing = (active ?? []).find((a) => a.kind === sale.kind && a.airline === sale.airline);
        const row = {
          couple_id: s.couple_id,
          kind: sale.kind,
          airline: sale.airline,
          direction: sale.direction,
          last_seen_at: new Date().toISOString(),
          dates_affected: [...new Set(sale.items.map((i) => i.date))],
          avg_drop_pct: sale.avgDropPct,
          cheapest_dates: sale.cheapest,
          items: sale.items,
          min_price: sale.minPrice,
        };
        let id: string;
        if (existing) {
          id = existing.id;
          seen.add(id);
          await db.from("flash_sales").update(row).eq("id", id);
        } else {
          const { data, error } = await db.from("flash_sales").insert(row).select("id").single();
          if (error) throw new Error(`flash_sales: ${error.message}`);
          id = data.id;
          seen.add(id);
        }

        if (!muted && shouldNotifyFlash(sale, previous)) {
          try {
            await sendFlashNotice(db, s, sale, id, trackers ?? []);
            await db.from("flash_sales").update({ notified_min_price: sale.minPrice }).eq("id", id);
          } catch (e) {
            job.logError(`aviso ${sale.kind} ${sale.airline}`, e);
          }
        }
        summary.push({ couple: s.couple_id, kind: sale.kind, airline: sale.airline, dates: sale.items.length, minPrice: sale.minPrice });
      }

      // Las ofertas activas que ya no se detectan han terminado: los precios volvieron a su nivel.
      for (const a of active ?? []) {
        if (seen.has(a.id)) continue;
        await db.from("flash_sales").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", a.id);
        summary.push({ couple: s.couple_id, ended: a.id, kind: a.kind, airline: a.airline });
      }
      summary.push({ couple: s.couple_id, warmup });
    }
    await job.finish({ summary });
    return { summary, errors: job.errors };
  } catch (e) {
    job.logError("detect_flash", e);
    await job.finish({ summary }, true);
    return { summary, errors: job.errors };
  }
}

async function sendFlashNotice(
  db: SupabaseClient,
  s: SettingsRow,
  sale: DetectedSale,
  saleId: string,
  trackers: Array<{ id: string; origin: string; destination: string; outbound_date: string; return_date: string | null; flex_days: number }>,
) {
  const affected = affectedTrackers(sale, trackers);
  const message = flashSaleMessage({ sale, affected, thresholdPrice: Number(s.flash_threshold_price), appUrl: appUrl() });
  await notify(db, {
    coupleId: s.couple_id,
    type: "flash_sale",
    message,
    travelerId: null,
    flashSaleId: saleId,
    payload: { airline: sale.airline, kind: sale.kind, dates: itemKeys(sale), minPrice: sale.minPrice, affected: affected.map((t) => t.id) },
  });
}
