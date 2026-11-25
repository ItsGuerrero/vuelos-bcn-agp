"use client";

import { useActionState } from "react";
import { updateProfile, type ActionState } from "../actions";

export function ProfileForm({ name, home }: { name: string; home: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProfile, {});
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Tu perfil</h2>
      <label className="field">
        <span>Nombre</span>
        <input name="display_name" defaultValue={name} className="input" />
      </label>
      <label className="field">
        <span>Vives en</span>
        <select name="home_airport" defaultValue={home} className="input">
          <option value="">—</option>
          <option value="AGP">Málaga (AGP)</option>
          <option value="BCN">Barcelona (BCN)</option>
        </select>
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-secondary" disabled={pending}>
          Guardar
        </button>
        {state.ok && <span className="text-sm text-emerald-600">{state.ok}</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
