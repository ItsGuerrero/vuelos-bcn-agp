import type { Airline } from "@/lib/types";
import { AEROLINEA } from "@/lib/format";

export function Page({ title, back, action, children }: { title: string; back?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2">
        {back && (
          <a href={back} className="-ml-2 rounded-full p-2 text-xl text-muted" aria-label="Volver">
            ‹
          </a>
        )}
        <h1 className="flex-1 truncate text-xl font-semibold">{title}</h1>
        {action}
      </header>
      {children}
    </main>
  );
}

export function AirlineBadge({ airline }: { airline: Airline }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-bold ${
        airline === "VY" ? "bg-vy text-black" : "bg-fr text-white dark:text-black"
      }`}
      title={AEROLINEA[airline]}
    >
      {airline}
    </span>
  );
}

export type Light = "green" | "amber" | "red" | "grey";

export function Semaforo({ light, label }: { light: Light; label: string }) {
  const color = { green: "bg-emerald-500", amber: "bg-amber-400", red: "bg-rose-500", grey: "bg-slate-400" }[light];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-border/60" />
      ))}
    </div>
  );
}

export function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null || current === previous) return <span className="text-xs text-muted">=</span>;
  const diff = Math.round((current - previous) * 100) / 100;
  const down = diff < 0;
  return (
    <span className={`text-xs font-semibold ${down ? "text-emerald-600" : "text-rose-600"}`}>
      {down ? "▼" : "▲"} {Math.abs(diff).toLocaleString("es-ES")} €
    </span>
  );
}
