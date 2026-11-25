import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/server/admin";
import { appUrl } from "@/lib/server/env";
import { sendMessage, webhookSecret } from "@/lib/notify/telegram";
import { esc } from "@/lib/notify/messages";
import { eur, rangoFechas } from "@/lib/format";

interface Update {
  message?: {
    text?: string;
    chat: { id: number; type: string; first_name?: string };
  };
}

const HELP = [
  "Soy el bot de <b>Vuelos BCN ⇄ AGP</b> ✈️",
  "Os aviso cuando baja el precio de vuestros viajes.",
  "",
  "Para conectar tu cuenta, ve a la web → <b>Cuenta</b> → «Conectar con Telegram».",
  "",
  "Comandos: /viajes (seguimientos activos) · /desconectar",
].join("\n");

/** Webhook del bot. Telegram manda el secreto en X-Telegram-Bot-Api-Secret-Token. */
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret()) {
    return new Response("No autorizado", { status: 401 });
  }
  const update = (await req.json().catch(() => ({}))) as Update;
  const msg = update.message;
  if (!msg?.text || msg.chat.type !== "private") return Response.json({ ok: true });

  const chatId = msg.chat.id;
  const [command, arg] = msg.text.trim().split(/\s+/, 2);
  const db = createAdminClient();

  try {
    if (command === "/start" && arg) {
      const code = arg.toUpperCase();
      const { data: profile } = await db.from("profiles").select("id, display_name").eq("telegram_link_code", code).maybeSingle();
      if (!profile) {
        await sendMessage(chatId, "Ese enlace ya no es válido. Vuelve a pulsar «Conectar con Telegram» en la web.");
      } else {
        // Un chat solo puede estar enlazado a un perfil; el código se renueva para que no se pueda reutilizar.
        await db.from("profiles").update({ telegram_chat_id: null }).eq("telegram_chat_id", chatId);
        await db
          .from("profiles")
          .update({ telegram_chat_id: chatId, telegram_link_code: randomBytes(5).toString("hex").toUpperCase() })
          .eq("id", profile.id);
        await sendMessage(
          chatId,
          `¡Listo${profile.display_name ? `, ${esc(profile.display_name)}` : ""}! 🎉 A partir de ahora te avisaré aquí cuando baje el precio de vuestros viajes.\n\nEscribe /viajes para ver los seguimientos activos.`,
        );
      }
    } else if (command === "/desconectar" || command === "/stop") {
      await db.from("profiles").update({ telegram_chat_id: null }).eq("telegram_chat_id", chatId);
      await sendMessage(chatId, "Hecho: ya no recibirás avisos aquí. Puedes volver a conectar desde la web cuando quieras.");
    } else if (command === "/viajes") {
      await sendMessage(chatId, await tripsText(db, chatId));
    } else {
      await sendMessage(chatId, HELP);
    }
  } catch (e) {
    console.error("[telegram webhook]", e);
  }
  return Response.json({ ok: true });
}

async function tripsText(db: ReturnType<typeof createAdminClient>, chatId: number): Promise<string> {
  const { data: profile } = await db.from("profiles").select("couple_id").eq("telegram_chat_id", chatId).maybeSingle();
  if (!profile?.couple_id) return "Aún no has conectado tu cuenta. Hazlo desde la web → Cuenta.";
  const { data: trackers } = await db
    .from("trackers")
    .select("id, origin, destination, outbound_date, return_date, lowest_price, with_baggage")
    .eq("couple_id", profile.couple_id)
    .eq("status", "active")
    .order("outbound_date");
  if (!trackers?.length) return "No tenéis seguimientos activos.";
  const lines = ["<b>Seguimientos activos</b>"];
  for (const t of trackers) {
    const { data: last } = await db
      .from("price_checks")
      .select("best_total, best_total_bags")
      .eq("tracker_id", t.id)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const now = last ? (t.with_baggage ? last.best_total_bags : last.best_total) : null;
    lines.push(
      `• <a href="${appUrl()}/seguimientos/${t.id}">${t.origin}${t.return_date ? "⇄" : "→"}${t.destination} ${esc(rangoFechas(t.outbound_date, t.return_date))}</a>: ${eur(now)} (mín. ${eur(t.lowest_price)})`,
    );
  }
  return lines.join("\n");
}
