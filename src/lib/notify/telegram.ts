import "server-only";
import { createHmac } from "node:crypto";
import type { InlineButton } from "./messages";

/** Cliente mínimo de la Bot API de Telegram. */

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export function telegramConfigured() {
  return Boolean(token());
}

/**
 * Secreto del webhook derivado de CRON_SECRET (así no hace falta otra variable).
 * Telegram lo manda en la cabecera X-Telegram-Bot-Api-Secret-Token.
 */
export function webhookSecret(): string {
  const base = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!base) throw new Error("Falta CRON_SECRET");
  return createHmac("sha256", base).update("telegram-webhook").digest("hex");
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const t = token();
  if (!t) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result as T;
}

export function sendMessage(chatId: number, text: string, buttons: InlineButton[][] = []) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function getBotUsername(): Promise<string | null> {
  if (!token()) return null;
  try {
    const me = await tg<{ username: string }>("getMe", {});
    return me.username;
  } catch {
    return null;
  }
}
