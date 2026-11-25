import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient, getSession } from "@/lib/supabase/server";
import { Page, Skeleton } from "@/components/ui";
import { SettingsForm } from "./SettingsForm";

export default function AjustesPage() {
  return (
    <Page title="Ajustes" back="/cuenta">
      <Suspense fallback={<Skeleton />}>
        <Settings />
      </Suspense>
    </Page>
  );
}

async function Settings() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.coupleId) redirect("/pareja");
  const supabase = await createClient();
  const { data: x } = await supabase.from("settings").select("*").eq("couple_id", s.coupleId).single();
  if (!x) return <p className="card text-sm">No se encontraron los ajustes.</p>;
  const times: string[] = x.flash_scan_times ?? ["09:00"];
  return (
    <>
      <p className="text-sm text-muted">Estos ajustes los compartís los dos.</p>
      <SettingsForm
        v={{
          vy_label: x.baggage_by_airline?.VY?.label ?? "Maleta de cabina",
          vy_price: Number(x.baggage_by_airline?.VY?.price ?? 0),
          fr_label: x.baggage_by_airline?.FR?.label ?? "Maleta de cabina",
          fr_price: Number(x.baggage_by_airline?.FR?.price ?? 0),
          new_low_min_drop_eur: Number(x.new_low_min_drop_eur),
          new_low_min_drop_pct: Number(x.new_low_min_drop_pct),
          telegram: x.notify_channels?.telegram !== false,
          daily_summary: Boolean(x.daily_summary),
          flash_enabled_anomaly: x.flash_enabled_anomaly,
          flash_enabled_threshold: x.flash_enabled_threshold,
          flash_min_dates_pct: Number(x.flash_min_dates_pct),
          flash_min_drop_pct: Number(x.flash_min_drop_pct),
          flash_threshold_price: Number(x.flash_threshold_price),
          flash_horizon_days: Math.min(90, Number(x.flash_horizon_days)),
          scan_1: times[0] ?? "09:00",
          scan_2: times[1] ?? "",
          flash_muted_until: x.flash_muted_until,
          monthlyLimit: Number(process.env.SERPAPI_MONTHLY_LIMIT ?? 250),
        }}
      />
    </>
  );
}
