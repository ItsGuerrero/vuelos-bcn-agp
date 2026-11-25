"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(traducir(error.message));
    else setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return setError(traducir(error.message));
    router.replace("/");
    router.refresh();
  }

  if (step === "code") {
    return (
      <form onSubmit={verify} className="card space-y-4">
        <p className="text-sm text-muted">
          Te hemos enviado un email a <b className="text-fg">{email}</b>. Pulsa el enlace del email (en este mismo
          navegador) o escribe aquí el código que aparece.
        </p>
        <label className="field">
          <span>Código</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="input text-center text-2xl tracking-[0.4em]"
            required
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Comprobando…" : "Entrar"}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={() => setStep("email")}>
          Usar otro email
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={sendEmail} className="card space-y-4">
      <label className="field">
        <span>Tu email</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          className="input"
          required
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Enviando…" : "Enviarme el acceso"}
      </button>
      <p className="text-xs text-muted">Sin contraseñas: te llega un enlace y un código por email.</p>
    </form>
  );
}

function traducir(msg: string) {
  if (/rate limit|security purposes/i.test(msg)) return "Demasiados intentos. Espera un minuto y vuelve a probar.";
  if (/expired|invalid/i.test(msg)) return "El código no es válido o ha caducado. Pide uno nuevo.";
  return msg;
}
