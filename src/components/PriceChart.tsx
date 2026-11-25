"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartPoint {
  t: number; // ms
  nuestro?: number;
  googleIda?: number;
  googleVuelta?: number;
}

const fmtDate = (t: number) =>
  new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Madrid" }).format(t).replace(".", "");
const fmtDateTime = (t: number) =>
  new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })
    .format(t)
    .replace(".", "");

/**
 * Evolución del precio: nuestro histórico (total del viaje) y, si Google lo da,
 * el price_history de cada trayecto (precio de un trayecto, no del viaje completo).
 */
export function PriceChart({ data, lowest }: { data: ChartPoint[]; lowest: number | null }) {
  const hasGoogle = data.some((d) => d.googleIda !== undefined || d.googleVuelta !== undefined);
  const ours = data.filter((d) => d.nuestro !== undefined);
  if (ours.length < 2 && !hasGoogle) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        La gráfica aparecerá cuando haya al menos dos comprobaciones.
      </p>
    );
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtDate}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            stroke="var(--border)"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            stroke="var(--border)"
            width={48}
            tickFormatter={(v: number) => `${v} €`}
            domain={["auto", "auto"]}
          />
          <Tooltip
            labelFormatter={(t) => fmtDateTime(Number(t))}
            formatter={(v) => `${Number(v).toLocaleString("es-ES")} €`}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
          />
          {hasGoogle && <Legend wrapperStyle={{ fontSize: 11 }} />}
          <Line
            name="Nuestro histórico (viaje)"
            dataKey="nuestro"
            stroke="var(--accent)"
            strokeWidth={2.5}
            dot={ours.length < 30}
            connectNulls
            isAnimationActive={false}
          />
          {hasGoogle && (
            <Line name="Google · ida" dataKey="googleIda" stroke="#f59e0b" strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
          )}
          {hasGoogle && (
            <Line name="Google · vuelta" dataKey="googleVuelta" stroke="#8b5cf6" strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
      {lowest !== null && <p className="mt-1 text-right text-xs text-muted">Mínimo histórico: {lowest.toLocaleString("es-ES")} €</p>}
    </div>
  );
}
