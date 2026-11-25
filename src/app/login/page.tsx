import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar · Vuelos BCN ⇄ AGP" };

const NOTICES: Record<string, string> = {
  confirmado: "¡Email confirmado! Ya puedes entrar con tu email y contraseña.",
  enlace: "El enlace no es válido o ha caducado. Prueba a entrar con tu contraseña o pide otro enlace.",
};

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-1 text-center">
        <p className="text-4xl">✈️</p>
        <h1 className="text-2xl font-semibold">Vuelos BCN ⇄ AGP</h1>
        <p className="text-sm text-muted">Vigilamos Vueling y Ryanair por vosotros.</p>
      </div>
      <Suspense fallback={<LoginForm />}>
        <WithNotice searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function WithNotice({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const key = typeof sp.aviso === "string" ? sp.aviso : typeof sp.error === "string" ? sp.error : "";
  return <LoginForm notice={NOTICES[key]} />;
}
