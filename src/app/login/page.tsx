import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar · Vuelos BCN ⇄ AGP" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-1 text-center">
        <p className="text-4xl">✈️</p>
        <h1 className="text-2xl font-semibold">Vuelos BCN ⇄ AGP</h1>
        <p className="text-sm text-muted">Vigilamos Vueling y Ryanair por vosotros.</p>
      </div>
      <LoginForm />
    </main>
  );
}
