import "server-only";
import type { Combo, DateMatrix } from "./core/combos";
import type { Airport, PriceInsights, TimeFilters } from "./types";
import { createClient } from "./supabase/server";
import { nowInZone } from "./core/dates";

export interface Tracker {
  id: string;
  couple_id: string;
  traveler_id: string | null;
  origin: Airport;
  destination: Airport;
  outbound_date: string;
  return_date: string | null;
  flex_days: number;
  passengers: number;
  time_filters: TimeFilters;
  with_baggage: boolean;
  target_price: number | null;
  check_interval_hours: number | null;
  status: "active" | "paused" | "purchased" | "expired";
  lowest_price: number | null;
  lowest_price_at: string | null;
  last_checked_at: string | null;
  next_check_at: string;
  purchased_price: number | null;
  purchased_at: string | null;
  notes: string | null;
  muted_until: string | null;
  created_at: string;
}

export interface PriceCheck {
  id: string;
  tracker_id: string;
  checked_at: string;
  providers: string[];
  best_total: number | null;
  best_total_bags: number | null;
  best_combo: Combo | null;
  alternatives: Combo[] | null;
  date_matrix: DateMatrix | null;
  insights: Partial<Record<"outbound" | "return", PriceInsights | null>> | null;
  errors: Array<{ where: string; message: string }> | null;
}

export interface Profile {
  id: string;
  display_name: string | null;
  home_airport: Airport | null;
  telegram_chat_id: number | null;
}

/** Total que se usa para comparar (con equipaje si el seguimiento lo pide). */
export function checkTotal(c: Pick<PriceCheck, "best_total" | "best_total_bags">, withBaggage: boolean): number | null {
  const v = withBaggage ? c.best_total_bags : c.best_total;
  return v === null ? null : Number(v);
}

export interface TrackerSummary extends Tracker {
  current: number | null;
  previous: number | null;
  lastCheck: PriceCheck | null;
}

export async function listTrackers(): Promise<TrackerSummary[]> {
  const supabase = await createClient();
  const { data: trackers, error } = await supabase
    .from("trackers")
    .select("*")
    .order("outbound_date", { ascending: true });
  if (error) throw new Error(error.message);
  const ids = (trackers ?? []).map((t) => t.id);
  const latest = new Map<string, PriceCheck[]>();
  if (ids.length) {
    const { data: checks } = await supabase
      .from("price_checks")
      .select("id, tracker_id, checked_at, providers, best_total, best_total_bags, best_combo, alternatives, errors")
      .in("tracker_id", ids)
      .order("checked_at", { ascending: false })
      .limit(ids.length * 6);
    for (const c of (checks ?? []) as PriceCheck[]) {
      const arr = latest.get(c.tracker_id) ?? [];
      if (arr.length < 2) arr.push(c);
      latest.set(c.tracker_id, arr);
    }
  }
  const order = { active: 0, paused: 1, purchased: 2, expired: 3 } as const;
  return ((trackers ?? []) as Tracker[])
    .map((t) => {
      const [last, prev] = latest.get(t.id) ?? [];
      return {
        ...t,
        lastCheck: last ?? null,
        current: last ? checkTotal(last, t.with_baggage) : null,
        previous: prev ? checkTotal(prev, t.with_baggage) : null,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.outbound_date.localeCompare(b.outbound_date));
}

export async function getTracker(id: string) {
  const supabase = await createClient();
  const { data: tracker } = await supabase.from("trackers").select("*").eq("id", id).maybeSingle();
  if (!tracker) return null;
  const { data: checks } = await supabase
    .from("price_checks")
    .select("*")
    .eq("tracker_id", id)
    .order("checked_at", { ascending: false })
    .limit(200);
  return { tracker: tracker as Tracker, checks: (checks ?? []) as PriceCheck[] };
}

export async function getCoupleProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, display_name, home_airport, telegram_chat_id").order("created_at");
  return (data ?? []) as Profile[];
}

export async function getCouple() {
  const supabase = await createClient();
  const { data } = await supabase.from("couples").select("id, name, invite_code").maybeSingle();
  return data as { id: string; name: string; invite_code: string } | null;
}

export interface UsageSummary {
  limit: number;
  month: { trackers: number; flash: number; manual: number; total: number };
  today: { trackers: number; flash: number; manual: number; total: number };
}

export async function getSerpApiUsage(): Promise<UsageSummary> {
  const supabase = await createClient();
  const z = nowInZone();
  const { data } = await supabase
    .from("api_usage")
    .select("day, purpose, calls")
    .eq("provider", "serpapi")
    .gte("day", z.monthStart);
  const month = { trackers: 0, flash: 0, manual: 0, total: 0 };
  const today = { trackers: 0, flash: 0, manual: 0, total: 0 };
  for (const r of data ?? []) {
    const p = r.purpose as "trackers" | "flash" | "manual";
    month[p] += r.calls;
    month.total += r.calls;
    if (r.day === z.date) {
      today[p] += r.calls;
      today.total += r.calls;
    }
  }
  return { limit: Number(process.env.SERPAPI_MONTHLY_LIMIT ?? 250), month, today };
}

export async function getRecentJobs(limit = 8) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_runs")
    .select("id, job, started_at, finished_at, status, errors")
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<{
    id: number;
    job: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    errors: Array<{ where: string; message: string }>;
  }>;
}
