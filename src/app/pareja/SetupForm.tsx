"use client";

import { useActionState, useState } from "react";
import { setupCouple, type ActionState } from "../actions";

export function SetupForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setupCouple, {});
  const [mode, setMode] = useState<"join" | "create">("join");

  return (
    <form action={action} className="space-y-4">
      <div className="card space-y-4">
        <label className="field">
          <span>¿Cómo te llamas?</span>
          <input name="display_name" defaultValue={defaultName} className="input" required />
        </label>
        <label className="field">
          <span>¿Dónde vives?</span>
          <select name="home_airport" className="input" defaultValue="">
            <option value="">Prefiero no decirlo</option>
            <option value="AGP">Málaga (AGP)</option>
            <option value="BCN">Barcelona (BCN)</option>
          </select>
        </label>
      </div>

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-background p-1 text-sm font-medium">
          {(["join", "create"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg py-2 ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {m === "join" ? "Tengo un código" : "Crear pareja nueva"}
            </button>
          ))}
        </div>
        {mode === "join" ? (
          <label className="field">
            <span>Código de invitación</span>
            <input name="invite_code" className="input uppercase tracking-widest" placeholder="ABCD1234" required />
            <span className="text-xs font-normal text-muted">Lo ve la otra persona en «Cuenta».</span>
          </label>
        ) : (
          <p className="text-sm text-muted">
            Se creará un espacio nuevo y vacío. Después podrás invitar a tu pareja con el código que aparecerá en «Cuenta».
          </p>
        )}
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Guardando…" : "Continuar"}
      </button>
    </form>
  );
}
