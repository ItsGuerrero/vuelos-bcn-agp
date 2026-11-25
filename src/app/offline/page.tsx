export const metadata = { title: "Sin conexión · Vuelos BCN ⇄ AGP" };

export default function Offline() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-4xl">📡</p>
      <h1 className="text-xl font-semibold">Sin conexión</h1>
      <p className="text-sm text-muted">
        Los precios cambian a cada momento, así que necesitamos internet para enseñártelos. La app sigue vigilando
        vuestros viajes y os avisará por Telegram.
      </p>
    </main>
  );
}
