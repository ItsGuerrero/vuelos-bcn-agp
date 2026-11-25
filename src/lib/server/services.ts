import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiPurpose } from "../types";
import { nowInZone } from "../core/dates";
import { planBudget, type BudgetPlan } from "../core/budget";
import { RyanairProvider } from "../providers/ryanair";
import { SerpApiProvider } from "../providers/serpapi";
import { serverEnv } from "./env";

// ---------------------------------------------------------------------
// Caché en base de datos (tabla provider_cache)
// ---------------------------------------------------------------------
export async function cached<T>(
  db: SupabaseClient,
  key: string,
  provider: string,
  ttlMinutes: number,
  load: () => Promise<T>,
): Promise<T> {
  const { data } = await db
    .from("provider_cache")
    .select("response, expires_at")
    .eq("key", key)
    .maybeSingle();
  if (data && new Date(data.expires_at) > new Date()) return data.response as T;
  const value = await load();
  await db.from("provider_cache").upsert({
    key,
    provider,
    response: value as object,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
  });
  return value;
}

// ---------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------
export function ryanair() {
  return new RyanairProvider();
}

export function serpApi(db: SupabaseClient, purpose: ApiPurpose): SerpApiProvider | null {
  const apiKey = serverEnv.serpApiKey;
  if (!apiKey) return null;
  return new SerpApiProvider({
    apiKey,
    calendarMaxDays: serverEnv.serpApiCalendarMaxDays,
    onCall: async () => {
      const { error } = await db.rpc("increment_api_usage", { p_provider: "serpapi", p_purpose: purpose, p_calls: 1 });
      if (error) console.error("No se pudo contar la llamada a SerpApi", error.message);
    },
  });
}

// ---------------------------------------------------------------------
// Presupuesto de SerpApi
// ---------------------------------------------------------------------
export function serpCallsPerScan(horizonDays: number) {
  return 2 * Math.ceil(horizonDays / serverEnv.serpApiCalendarMaxDays);
}

export async function currentBudget(db: SupabaseClient, scansPerDay: number, horizonDays: number): Promise<BudgetPlan> {
  const z = nowInZone();
  const { data, error } = await db
    .from("api_usage")
    .select("day, purpose, calls")
    .eq("provider", "serpapi")
    .gte("day", z.monthStart);
  if (error) throw new Error(`api_usage: ${error.message}`);
  const usedToday = { flash: 0, trackers: 0, manual: 0 };
  let usedBeforeToday = 0;
  for (const r of data ?? []) {
    if (r.day === z.date) usedToday[r.purpose as ApiPurpose] += r.calls;
    else usedBeforeToday += r.calls;
  }
  return planBudget({
    monthlyLimit: serverEnv.serpApiMonthlyLimit,
    usedBeforeToday,
    usedToday,
    dayOfMonth: z.dayOfMonth,
    daysInMonth: z.daysInMonth,
    scansPerDayConfigured: scansPerDay,
    callsPerScan: serpCallsPerScan(horizonDays),
    detailCapPerDay: serverEnv.serpApiDetailCapPerDay,
  });
}

// ---------------------------------------------------------------------
// Registro de procesos (job_runs)
// ---------------------------------------------------------------------
export async function startJob(db: SupabaseClient, job: string) {
  const { data, error } = await db.from("job_runs").insert({ job }).select("id").single();
  if (error) throw new Error(`job_runs: ${error.message}`);
  const errors: Array<{ where: string; message: string }> = [];
  return {
    errors,
    logError(where: string, e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[${job}] ${where}: ${message}`);
      errors.push({ where, message: message.slice(0, 500) });
    },
    async finish(details: Record<string, unknown>, failed = false) {
      const status = failed ? "error" : errors.length ? "partial" : "ok";
      await db
        .from("job_runs")
        .update({ finished_at: new Date().toISOString(), status, details, errors })
        .eq("id", data.id);
      return status;
    },
  };
}
