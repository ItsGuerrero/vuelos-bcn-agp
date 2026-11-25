"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    setPassword("");
    setMsg(error ? { error: error.message } : { ok: "Contraseña cambiada" });
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-semibold">Cambiar contraseña</h2>
      <input
        type="password"
        autoComplete="new-password"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Nueva contraseña (mín. 8)"
        className="input"
        required
      />
      <div className="flex items-center gap-3">
        <button className="btn-secondary" disabled={busy}>
          Cambiar
        </button>
        {msg.ok && <span className="text-sm text-emerald-600">{msg.ok}</span>}
        {msg.error && <span className="text-sm text-red-600">{msg.error}</span>}
      </div>
    </form>
  );
}
