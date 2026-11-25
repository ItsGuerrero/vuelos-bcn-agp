"use client";

import { useState, useTransition } from "react";
import { sendTestTelegram, unlinkTelegram, type ActionState } from "../actions";

export function TelegramCard({
  linked,
  partnerLinked,
  partnerName,
  connectUrl,
}: {
  linked: boolean;
  partnerLinked: boolean | null;
  partnerName: string | null;
  connectUrl: string | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Avisos por Telegram</h2>
      {linked ? (
        <>
          <p className="text-sm">✅ Conectado. Te llegarán los avisos de los viajes en los que viajas tú (o los dos).</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={pending} onClick={() => start(async () => setMsg(await sendTestTelegram()))}>
              Enviar aviso de prueba
            </button>
            <button className="btn-ghost text-rose-600" disabled={pending} onClick={() => start(() => unlinkTelegram())}>
              Desconectar
            </button>
          </div>
        </>
      ) : connectUrl ? (
        <>
          <p className="text-sm text-muted">
            Pulsa el botón, se abrirá Telegram y dale a <b>Iniciar</b>. Después vuelve aquí y recarga la página.
          </p>
          <a href={connectUrl} target="_blank" rel="noopener noreferrer" className="btn-primary w-full bg-[#229ED9]">
            Conectar con Telegram
          </a>
        </>
      ) : (
        <p className="text-sm text-amber-600">El bot de Telegram aún no está configurado en el servidor.</p>
      )}
      {partnerLinked !== null && (
        <p className="text-xs text-muted">
          {partnerName ?? "Tu pareja"}: {partnerLinked ? "conectada ✅" : "aún sin conectar"}
        </p>
      )}
      {msg.ok && <p className="text-sm text-emerald-600">{msg.ok}</p>}
      {msg.error && <p className="text-sm text-red-600">{msg.error}</p>}
    </section>
  );
}
