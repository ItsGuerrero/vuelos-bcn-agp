import { isAuthorizedCron } from "@/lib/server/admin";
import { appUrl } from "@/lib/server/env";
import { tg, webhookSecret } from "@/lib/notify/telegram";

/**
 * Registra el webhook del bot y sus comandos. Se ejecuta una vez (o tras cambiar el dominio):
 *   POST /api/telegram/setup   Authorization: Bearer <CRON_SECRET>
 */
export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const url = `${appUrl()}/api/telegram/webhook`;
    await tg("setWebhook", {
      url,
      secret_token: webhookSecret(),
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
    await tg("setMyCommands", {
      commands: [
        { command: "viajes", description: "Ver los seguimientos activos" },
        { command: "desconectar", description: "Dejar de recibir avisos aquí" },
      ],
      language_code: "es",
    });
    await tg("setMyDescription", {
      description: "Avisos de precios de Vueling y Ryanair entre Barcelona y Málaga. Conecta tu cuenta desde la web.",
    });
    const me = await tg<{ username: string }>("getMe", {});
    const info = await tg<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo", {});
    return Response.json({ ok: true, bot: me.username, webhook: info.url, lastError: info.last_error_message ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
