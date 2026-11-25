import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramMessage } from "./messages";
import { sendMessage, telegramConfigured } from "./telegram";
import { pickRecipients } from "./recipients";

export type NotificationType = "new_low" | "target_price" | "rise_risk" | "flash_sale" | "daily_summary";

export interface NotifyInput {
  coupleId: string;
  type: NotificationType;
  message: TelegramMessage;
  /** Quién debe recibirlo: un perfil concreto o null = los dos. */
  travelerId: string | null;
  trackerId?: string | null;
  flashSaleId?: string | null;
  /** Clave anti-duplicados: si ya se envió un aviso con la misma clave en `dedupeHours`, no se repite. */
  dedupeKey?: string;
  dedupeHours?: number;
  payload?: Record<string, unknown>;
}

export async function notify(db: SupabaseClient, n: NotifyInput): Promise<{ sent: number; skipped?: string }> {
  if (n.dedupeKey) {
    const since = new Date(Date.now() - (n.dedupeHours ?? 48) * 3_600_000).toISOString();
    const { data } = await db
      .from("notifications")
      .select("id")
      .eq("couple_id", n.coupleId)
      .eq("dedupe_key", n.dedupeKey)
      .gte("sent_at", since)
      .limit(1);
    if (data?.length) return { sent: 0, skipped: "duplicado" };
  }

  const { data: profiles } = await db.from("profiles").select("id, telegram_chat_id").eq("couple_id", n.coupleId);
  const recipients = pickRecipients(profiles ?? [], n.travelerId);

  let sent = 0;
  const errors: string[] = [];
  if (telegramConfigured()) {
    for (const r of recipients) {
      try {
        await sendMessage(r.chat, n.message.text, n.message.buttons);
        sent++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  // Se registra siempre (aunque nadie tenga Telegram enlazado) para el historial y el anti-spam.
  await db.from("notifications").insert({
    couple_id: n.coupleId,
    tracker_id: n.trackerId ?? null,
    flash_sale_id: n.flashSaleId ?? null,
    type: n.type,
    channel: "telegram",
    recipients: recipients.map((r) => r.id),
    dedupe_key: n.dedupeKey ?? null,
    payload: { text: n.message.text, sent, errors, ...(n.payload ?? {}) },
  });

  if (errors.length && !sent) throw new Error(errors[0]);
  return { sent, skipped: recipients.length ? undefined : "nadie tiene Telegram enlazado" };
}
