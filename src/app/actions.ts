"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getSession } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/server/admin";
import { currentBudget } from "@/lib/server/services";
import { checkDueTrackers } from "@/lib/jobs/checkTrackers";
import { nowInZone } from "@/lib/core/dates";

export interface ActionState {
  error?: string;
  ok?: string;
}

async function requireCouple() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.coupleId) redirect("/pareja");
  return s as typeof s & { coupleId: string };
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

// ---------------------------------------------------------------------
// Sesión y pareja
// ---------------------------------------------------------------------
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function setupCouple(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!s) redirect("/login");
  const supabase = await createClient();

  const name = str(fd, "display_name");
  const home = str(fd, "home_airport");
  await supabase
    .from("profiles")
    .update({ display_name: name || null, home_airport: home === "BCN" || home === "AGP" ? home : null })
    .eq("id", s.userId);

  if (!s.coupleId) {
    const code = str(fd, "invite_code");
    const { error } = code
      ? await supabase.rpc("join_couple", { p_invite_code: code })
      : await supabase.rpc("create_couple", { p_name: "Nuestra pareja" });
    if (error) return { error: error.message };
  }
  redirect("/");
}

export async function updateProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireCouple();
  const supabase = await createClient();
  const home = str(fd, "home_airport");
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: str(fd, "display_name") || null, home_airport: home === "BCN" || home === "AGP" ? home : null })
    .eq("id", s.userId);
  if (error) return { error: error.message };
  revalidatePath("/cuenta");
  return { ok: "Guardado" };
}

// ---------------------------------------------------------------------
// Seguimientos
// ---------------------------------------------------------------------
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

const trackerSchema = z
  .object({
    origin: z.enum(["BCN", "AGP"]),
    outbound_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de ida no válida"),
    return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    flex_days: z.coerce.number().int().min(0).max(3),
    passengers: z.coerce.number().int().min(1).max(9),
    traveler_id: z.string().uuid().nullable(),
    target_price: z.coerce.number().positive().nullable(),
    check_interval_hours: z.coerce.number().int().min(3).max(72).nullable(),
    with_baggage: z.boolean(),
    out_after: hhmm,
    out_before: hhmm,
    ret_after: hhmm,
    ret_before: hhmm,
    notes: z.string().max(200).nullable(),
  })
  .refine((v) => !v.return_date || v.return_date >= v.outbound_date, {
    message: "La vuelta no puede ser antes que la ida",
  });

function parseTracker(fd: FormData) {
  const oneWay = fd.get("one_way") === "on";
  const nullable = (k: string) => str(fd, k) || null;
  return trackerSchema.safeParse({
    origin: str(fd, "origin"),
    outbound_date: str(fd, "outbound_date"),
    return_date: oneWay ? null : nullable("return_date"),
    flex_days: str(fd, "flex_days") || 0,
    passengers: str(fd, "passengers") || 1,
    traveler_id: str(fd, "traveler_id") || null,
    target_price: nullable("target_price"),
    check_interval_hours: nullable("check_interval_hours"),
    with_baggage: fd.get("with_baggage") === "on",
    out_after: str(fd, "out_after"),
    out_before: str(fd, "out_before"),
    ret_after: str(fd, "ret_after"),
    ret_before: str(fd, "ret_before"),
    notes: nullable("notes"),
  });
}

export async function saveTracker(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireCouple();
  const parsed = parseTracker(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el formulario" };
  const v = parsed.data;
  if (v.outbound_date < nowInZone().date) return { error: "La fecha de ida ya ha pasado" };
  if (!v.return_date && fd.get("one_way") !== "on") return { error: "Indica la fecha de vuelta o marca «Solo ida»" };

  const win = (after?: string, before?: string) =>
    after || before ? { ...(after ? { after } : {}), ...(before ? { before } : {}) } : undefined;
  const time_filters = {
    ...(win(v.out_after, v.out_before) ? { outbound: win(v.out_after, v.out_before) } : {}),
    ...(v.return_date && win(v.ret_after, v.ret_before) ? { return: win(v.ret_after, v.ret_before) } : {}),
  };

  const row = {
    origin: v.origin,
    destination: v.origin === "BCN" ? "AGP" : "BCN",
    outbound_date: v.outbound_date,
    return_date: v.return_date,
    flex_days: v.flex_days,
    passengers: v.passengers,
    traveler_id: v.traveler_id,
    target_price: v.target_price,
    check_interval_hours: v.check_interval_hours,
    with_baggage: v.with_baggage,
    time_filters,
    notes: v.notes,
  };

  const supabase = await createClient();
  const id = str(fd, "id");
  if (id) {
    // Si cambian fechas, pasajeros o filtros, el histórico ya no es comparable: reiniciamos los mínimos.
    const { error } = await supabase
      .from("trackers")
      .update({ ...row, lowest_price: null, first_price: null, notified_low: null, next_check_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath(`/seguimientos/${id}`);
    revalidatePath("/");
    redirect(`/seguimientos/${id}`);
  }

  const { data, error } = await supabase
    .from("trackers")
    .insert({ ...row, couple_id: s.coupleId, created_by: s.userId })
    .select("id")
    .single();
  if (error) return { error: error.message };
  // Primera comprobación inmediata (solo Ryanair + escaneo de Vueling; detalle si hay presupuesto).
  await runCheck(data.id).catch(() => undefined);
  revalidatePath("/");
  redirect(`/seguimientos/${data.id}`);
}

async function runCheck(trackerId: string) {
  const admin = createAdminClient();
  const budget = await currentBudget(admin, 2, 90).catch(() => null);
  return checkDueTrackers(admin, { trackerId, detailCallsAvailable: budget?.detailCallsRemainingToday ?? 0 });
}

/** Comprueba el precio ahora mismo (no espera al proceso horario). */
export async function checkNow(trackerId: string): Promise<ActionState> {
  await requireCouple();
  const supabase = await createClient();
  // RLS: solo encuentra el seguimiento si es de mi pareja.
  const { data } = await supabase.from("trackers").select("id, status").eq("id", trackerId).maybeSingle();
  if (!data) return { error: "Seguimiento no encontrado" };
  if (data.status !== "active") return { error: "El seguimiento no está activo" };
  const r = await runCheck(trackerId);
  revalidatePath(`/seguimientos/${trackerId}`);
  revalidatePath("/");
  return r.errors.length ? { error: `Comprobado con avisos: ${r.errors[0].message}` } : { ok: "Precio actualizado" };
}

export async function markPurchased(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireCouple();
  const id = str(fd, "id");
  const price = Number(str(fd, "purchased_price").replace(",", "."));
  if (!(price > 0)) return { error: "Indica el precio que pagasteis" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("trackers")
    .update({ status: "purchased", purchased_price: price, purchased_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/seguimientos/${id}`);
  revalidatePath("/");
  return { ok: "¡Buen viaje! Seguimiento detenido." };
}

export async function setTrackerStatus(id: string, status: "active" | "paused") {
  await requireCouple();
  const supabase = await createClient();
  await supabase
    .from("trackers")
    .update({ status, ...(status === "active" ? { next_check_at: new Date().toISOString() } : {}) })
    .eq("id", id)
    .in("status", ["active", "paused"]);
  revalidatePath(`/seguimientos/${id}`);
  revalidatePath("/");
}

export async function deleteTracker(id: string) {
  await requireCouple();
  const supabase = await createClient();
  await supabase.from("trackers").delete().eq("id", id);
  revalidatePath("/");
  redirect("/");
}

// ---------------------------------------------------------------------
// Telegram y silenciar avisos
// ---------------------------------------------------------------------
export async function sendTestTelegram(): Promise<ActionState> {
  const s = await requireCouple();
  const { data } = await createAdminClient().from("profiles").select("telegram_chat_id").eq("id", s.userId).single();
  if (!data?.telegram_chat_id) return { error: "Aún no has conectado Telegram" };
  const { sendMessage } = await import("@/lib/notify/telegram");
  try {
    await sendMessage(
      Number(data.telegram_chat_id),
      "🔔 <b>Aviso de prueba</b>\nAsí te llegarán los avisos de bajadas de precio. ¡Todo funciona!",
    );
    return { ok: "Mensaje enviado" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function unlinkTelegram() {
  const s = await requireCouple();
  // Los campos de Telegram solo los puede tocar el backend (ver migración profiles_column_grants).
  await createAdminClient().from("profiles").update({ telegram_chat_id: null }).eq("id", s.userId);
  revalidatePath("/cuenta");
}

export async function muteTracker(id: string, days: number) {
  await requireCouple();
  const supabase = await createClient();
  const until = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  await supabase.from("trackers").update({ muted_until: until }).eq("id", id);
  revalidatePath(`/seguimientos/${id}`);
}

// ---------------------------------------------------------------------
// Ajustes de la pareja
// ---------------------------------------------------------------------
const num = (min: number, max: number) => z.coerce.number().min(min).max(max);
const settingsSchema = z.object({
  vy_label: z.string().max(40),
  vy_price: num(0, 200),
  fr_label: z.string().max(40),
  fr_price: num(0, 200),
  new_low_min_drop_eur: num(0, 100),
  new_low_min_drop_pct: num(0, 50),
  telegram: z.boolean(),
  daily_summary: z.boolean(),
  flash_enabled_anomaly: z.boolean(),
  flash_enabled_threshold: z.boolean(),
  flash_min_dates_pct: num(5, 100),
  flash_min_drop_pct: num(5, 90),
  flash_threshold_price: num(5, 200),
  flash_horizon_days: z.coerce.number().int().refine((v) => [30, 60, 90].includes(v), "Horizonte no válido"),
  scan_1: z.string().regex(/^([01]\d|2[0-3]):00$/, "Hora de escaneo no válida"),
  scan_2: z.string().regex(/^([01]\d|2[0-3]):00$/).or(z.literal("")),
});

export async function saveSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireCouple();
  const parsed = settingsSchema.safeParse({
    vy_label: str(fd, "vy_label"),
    vy_price: str(fd, "vy_price").replace(",", ".") || 0,
    fr_label: str(fd, "fr_label"),
    fr_price: str(fd, "fr_price").replace(",", ".") || 0,
    new_low_min_drop_eur: str(fd, "new_low_min_drop_eur").replace(",", ".") || 0,
    new_low_min_drop_pct: str(fd, "new_low_min_drop_pct").replace(",", ".") || 0,
    telegram: fd.get("telegram") === "on",
    daily_summary: fd.get("daily_summary") === "on",
    flash_enabled_anomaly: fd.get("flash_enabled_anomaly") === "on",
    flash_enabled_threshold: fd.get("flash_enabled_threshold") === "on",
    flash_min_dates_pct: str(fd, "flash_min_dates_pct"),
    flash_min_drop_pct: str(fd, "flash_min_drop_pct"),
    flash_threshold_price: str(fd, "flash_threshold_price").replace(",", "."),
    flash_horizon_days: str(fd, "flash_horizon_days"),
    scan_1: str(fd, "scan_1"),
    scan_2: str(fd, "scan_2"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los ajustes" };
  const v = parsed.data;
  const scanTimes = [...new Set([v.scan_1, v.scan_2].filter(Boolean))].sort();

  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update({
      baggage_by_airline: { VY: { label: v.vy_label || "Equipaje", price: v.vy_price }, FR: { label: v.fr_label || "Equipaje", price: v.fr_price } },
      new_low_min_drop_eur: v.new_low_min_drop_eur,
      new_low_min_drop_pct: v.new_low_min_drop_pct,
      notify_channels: { telegram: v.telegram, push: false, email: false },
      daily_summary: v.daily_summary,
      flash_enabled_anomaly: v.flash_enabled_anomaly,
      flash_enabled_threshold: v.flash_enabled_threshold,
      flash_min_dates_pct: v.flash_min_dates_pct,
      flash_min_drop_pct: v.flash_min_drop_pct,
      flash_threshold_price: v.flash_threshold_price,
      flash_horizon_days: v.flash_horizon_days,
      flash_scan_times: scanTimes,
    })
    .eq("couple_id", s.coupleId);
  if (error) return { error: error.message };
  revalidatePath("/ajustes");
  return { ok: "Ajustes guardados" };
}

export async function muteFlash(days: number) {
  const s = await requireCouple();
  const supabase = await createClient();
  const until = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  await supabase.from("settings").update({ flash_muted_until: until }).eq("couple_id", s.coupleId);
  revalidatePath("/ajustes");
  revalidatePath("/ofertas");
}
