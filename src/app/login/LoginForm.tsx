"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "magic";

/**
 * Acceso con email y contraseña.
 * - Crear cuenta: Supabase envía un email de confirmación. El enlace confirma la
 *   cuenta aunque se abra en otro navegador; después se entra con la contraseña.
 * - Enlace por email: alternativa si se olvida la contraseña (hay que abrirlo en
 *   el mismo navegador). Luego se puede poner una contraseña nueva en «Cuenta».
 */
export function LoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (error) return setError(traducir(error.message));
      router.replace("/");
      router.refresh();
      return;
    }
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: redirectTo },
      });
      setBusy(false);
      if (error) return setError(traducir(error.message));
      if (data.session) {
        router.replace("/");
        router.refresh();
        return;
      }
      setMode("login");
      setInfo("Te hemos enviado un email para confirmar la cuenta. Pulsa el enlace y luego vuelve aquí para entrar.");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    setBusy(false);
    if (error) return setError(traducir(error.message));
    setInfo("Te hemos enviado un enlace. Ábrelo en ESTE navegador para entrar; después puedes cambiar la contraseña en «Cuenta».");
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      {mode !== "magic" && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-background p-1 text-sm font-medium">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded-lg py-2 ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {m === "login" ? "Entrar" : "Crear cuenta"}
            </button>
          ))}
        </div>
      )}

      <label className="field">
        <span>Email</span>
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

      {mode !== "magic" && (
        <label className="field">
          <span>Contraseña</span>
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === "signup" ? 8 : undefined}
            className="input"
            required
          />
          {mode === "signup" && <span className="text-xs font-normal text-muted">Mínimo 8 caracteres.</span>}
        </label>
      )}

      {info && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{info}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Un momento…" : mode === "login" ? "Entrar" : mode === "signup" ? "Crear cuenta" : "Enviarme un enlace"}
      </button>

      <button
        type="button"
        className="btn-ghost w-full"
        onClick={() => {
          setMode(mode === "magic" ? "login" : "magic");
          setError(null);
          setInfo(null);
        }}
      >
        {mode === "magic" ? "Volver" : "¿Olvidaste la contraseña?"}
      </button>
    </form>
  );
}

function traducir(msg: string) {
  if (/invalid login credentials/i.test(msg)) return "Email o contraseña incorrectos.";
  if (/email not confirmed/i.test(msg)) return "Aún no has confirmado el email. Busca el correo de Supabase y pulsa el enlace.";
  if (/already registered|already been registered/i.test(msg)) return "Ese email ya tiene cuenta: usa «Entrar».";
  if (/rate limit|security purposes/i.test(msg)) return "Demasiados intentos. Espera unos minutos y vuelve a probar.";
  if (/signups not allowed|not allowed for otp/i.test(msg)) return "No hay ninguna cuenta con ese email.";
  if (/password should be/i.test(msg)) return "La contraseña es demasiado débil (mínimo 8 caracteres).";
  return msg;
}
