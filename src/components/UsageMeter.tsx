import type { UsageSummary } from "@/lib/data";

/** Contador de búsquedas de SerpApi del mes, separado por uso. */
export function UsageMeter({ usage, compact = false }: { usage: UsageSummary; compact?: boolean }) {
  const { limit, month } = usage;
  const pct = (n: number) => `${Math.min(100, (n / limit) * 100)}%`;
  const left = Math.max(0, limit - month.total);
  return (
    <div className={compact ? "space-y-1.5" : "card space-y-3"}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Búsquedas de Google Flights</span>
        <span className="text-muted">
          {month.total} / {limit} este mes
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-border">
        <div className="bg-sky-500" style={{ width: pct(month.flash) }} title="Escaneo de la ruta" />
        <div className="bg-violet-500" style={{ width: pct(month.trackers) }} title="Seguimientos" />
        <div className="bg-slate-400" style={{ width: pct(month.manual) }} title="Pruebas" />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />
          Escaneo de la ruta: {month.flash}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-500" />
          Seguimientos: {month.trackers}
        </span>
        {month.manual > 0 && (
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" />
            Pruebas: {month.manual}
          </span>
        )}
        {!compact && <span>Hoy: {usage.today.total}</span>}
        {!compact && <span>Quedan: {left}</span>}
      </div>
    </div>
  );
}
