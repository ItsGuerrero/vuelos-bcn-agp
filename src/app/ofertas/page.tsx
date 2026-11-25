import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient, getSession } from "@/lib/supabase/server";
import { computeBaselines, inWarmup, median, MIN_HISTORY_SCANS, type BaselineRow, type SaleItem, type ScanPoint } from "@/lib/core/flash";
import { addDays, nowInZone } from "@/lib/core/dates";
import type { Airline, Direction } from "@/lib/types";
import { AEROLINEA, eur, fechaCorta, haceCuanto } from "@/lib/format";
import { AirlineBadge, Page, Skeleton } from "@/components/ui";

export default function OfertasPage() {
  return (
    <Page title="Ofertas">
      <Suspense fallback={<Skeleton />}>
        <Offers />
      </Suspense>
    </Page>
  );
}

interface FlashRow {
  id: string;
  kind: "anomaly" | "threshold";
  airline: Airline;
  direction: Direction | null;
  detected_at: string;
  last_seen_at: string;
  ended_at: string | null;
  status: "active" | "ended";
  dates_affected: string[];
  avg_drop_pct: number | null;
  min_price: number | null;
  cheapest_dates: Record<Direction, SaleItem[]> | null;
}

async function Offers() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.coupleId) redirect("/pareja");
  const supabase = await createClient();
  const [latest, base, sales, settings] = await Promise.all([
    supabase.rpc("route_latest_prices"),
    supabase.rpc("route_baselines", { p_days: 30 }),
    supabase.from("flash_sales").select("*").order("detected_at", { ascending: false }).limit(50),
    supabase.from("settings").select("flash_threshold_price, flash_min_drop_pct, flash_min_dates_pct").maybeSingle(),
  ]);

  const points: ScanPoint[] = (latest.data ?? []).map((r: { direction: Direction; airline: Airline; flight_date: string; min_price: number | null }) => ({
    direction: r.direction,
    airline: r.airline,
    date: r.flight_date,
    price: r.min_price === null ? null : Number(r.min_price),
  }));
  const rows: BaselineRow[] = (base.data ?? []).map((r: { direction: Direction; airline: Airline; flight_date: string; median: number; n: number }) => ({
    direction: r.direction,
    airline: r.airline,
    date: r.flight_date,
    median: Number(r.median),
    n: r.n,
  }));
  const all = (sales.data ?? []) as FlashRow[];
  const active = all.filter((x) => x.status === "active");
  const ended = all.filter((x) => x.status === "ended");
  const warm = { VY: inWarmup(rows, "VY"), FR: inWarmup(rows, "FR") };
  const scansSoFar = Math.max(0, ...rows.map((r) => r.n)) + (points.length ? 1 : 0);
  const threshold = Number(settings.data?.flash_threshold_price ?? 20);

  return (
    <div className="space-y-5">
      <p className="text-right text-xs">
        <Link href="/ajustes" className="text-accent">
          Ajustar el detector ›
        </Link>
      </p>
      {(warm.VY || warm.FR) && (
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <b>Calentando el detector.</b> Llevamos {scansSoFar} {scansSoFar === 1 ? "escaneo" : "escaneos"} de la ruta. La detección de
          rebajas generales se activa con {MIN_HISTORY_SCANS + 1} (unos 2–3 días). Mientras tanto solo avisamos de chollos por debajo de{" "}
          {eur(threshold)} el trayecto.
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Ofertas activas</h2>
        {active.length === 0 ? (
          <p className="card text-sm text-muted">Ahora mismo no hay ofertas en BCN⇄AGP. Os avisaremos por Telegram en cuanto aparezca una.</p>
        ) : (
          active.map((x) => <SaleCard key={x.id} sale={x} threshold={threshold} />)
        )}
      </section>

      {(["BCN-AGP", "AGP-BCN"] as Direction[]).map((d) => (
        <Heatmap key={d} direction={d} points={points.filter((p) => p.direction === d)} rows={rows} />
      ))}

      <section className="card space-y-2">
        <h2 className="font-semibold">Historial de ofertas</h2>
        {ended.length === 0 ? (
          <p className="text-sm text-muted">Aún no ha terminado ninguna oferta. Con el tiempo aquí veréis cada cuánto hace rebajas cada aerolínea.</p>
        ) : (
          <>
            <p className="text-xs text-muted">
              {(["VY", "FR"] as Airline[]).map((a) => `${AEROLINEA[a]}: ${all.filter((x) => x.airline === a && x.kind === "anomaly").length} rebajas`).join(" · ")}
            </p>
            <ul className="divide-y divide-border text-sm">
              {ended.map((x) => (
                <li key={x.id} className="flex items-center gap-2 py-2">
                  <AirlineBadge airline={x.airline} />
                  <span className="flex-1">
                    {x.kind === "anomaly" ? `Rebaja del ${Math.round(Number(x.avg_drop_pct ?? 0))} %` : `Chollo desde ${eur(x.min_price)}`}
                    <span className="block text-xs text-muted">
                      {x.dates_affected.length} fechas · empezó el {fechaCorta(x.detected_at.slice(0, 10))}
                    </span>
                  </span>
                  <span className="text-xs text-muted">{duration(x.detected_at, x.ended_at ?? x.last_seen_at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function duration(from: string, to: string) {
  const h = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 3_600_000));
  return h < 48 ? `duró ${h} h` : `duró ${Math.round(h / 24)} días`;
}

function SaleCard({ sale, threshold }: { sale: FlashRow; threshold: number }) {
  const name = AEROLINEA[sale.airline];
  return (
    <div className="card space-y-2 ring-2 ring-orange-300/60">
      <div className="flex items-center gap-2">
        <AirlineBadge airline={sale.airline} />
        <p className="flex-1 font-semibold">
          {sale.kind === "anomaly"
            ? `${name}: ${sale.dates_affected.length} fechas un ${Math.round(Number(sale.avg_drop_pct ?? 0))} % más baratas`
            : `${name}: trayectos por ${eur(threshold)} o menos`}
        </p>
      </div>
      {(["BCN-AGP", "AGP-BCN"] as Direction[]).map((d) => {
        const items = sale.cheapest_dates?.[d] ?? [];
        if (!items.length) return null;
        return (
          <div key={d} className="text-sm">
            <span className="text-muted">{d.replace("-", "→")}: </span>
            {items.slice(0, 5).map((i, k) => (
              <Link
                key={i.date}
                href={`/seguimientos/nuevo?origin=${d.slice(0, 3)}&out=${i.date}`}
                className="font-medium text-accent"
              >
                {k > 0 && ", "}
                {fechaCorta(i.date)} ({eur(i.price)})
              </Link>
            ))}
          </div>
        );
      })}
      <p className="text-xs text-muted">Detectada {haceCuanto(sale.detected_at)} · última vez vista {haceCuanto(sale.last_seen_at)}</p>
    </div>
  );
}

/** Mapa de calor: el color indica lo barato que está cada día respecto a lo habitual. */
function Heatmap({ direction, points, rows }: { direction: Direction; points: ScanPoint[]; rows: BaselineRow[] }) {
  const today = nowInZone().date;
  const baselines = computeBaselines(points, rows);
  const byDate = new Map<string, { price: number; airline: Airline; ratio: number | null; other: { airline: Airline; price: number } | null }>();
  const prices = points.filter((p) => p.price !== null).map((p) => p.price!) ;
  const overall = median(prices);

  for (const date of new Set(points.map((p) => p.date))) {
    const opts = points.filter((p) => p.date === date && p.price !== null).sort((a, b) => a.price! - b.price!);
    if (!opts.length) continue;
    const best = opts[0];
    const b = baselines.get(`${direction}|${best.airline}|${date}`)?.value ?? overall;
    byDate.set(date, {
      price: best.price!,
      airline: best.airline,
      ratio: b ? best.price! / b : null,
      other: opts[1] ? { airline: opts[1].airline, price: opts[1].price! } : null,
    });
  }
  if (!byDate.size) return null;

  const dates = [...byDate.keys()].sort();
  const last = dates[dates.length - 1];
  // Empezamos la cuadrícula en el lunes de esta semana.
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells: string[] = [];
  for (let d = addDays(today, -dow); d <= last; d = addDays(d, 1)) cells.push(d);

  const color = (r: number | null) => {
    if (r === null) return "bg-border/50";
    if (r <= 0.7) return "bg-emerald-600 text-white";
    if (r <= 0.85) return "bg-emerald-400 text-black";
    if (r <= 1.0) return "bg-emerald-100 text-black dark:bg-emerald-900 dark:text-white";
    if (r <= 1.2) return "bg-amber-200 text-black";
    return "bg-rose-300 text-black";
  };

  return (
    <section className="card space-y-2">
      <h2 className="font-semibold">{direction === "BCN-AGP" ? "Barcelona → Málaga" : "Málaga → Barcelona"}</h2>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted">
        {["L", "M", "X", "J", "V", "S", "D"].map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const c = byDate.get(d);
          const isFirst = d.endsWith("-01");
          if (!c || d < today)
            return (
              <span key={d} className="flex aspect-square flex-col items-center justify-center rounded-md text-[10px] text-muted/50">
                {isFirst ? fechaCorta(d) : Number(d.slice(8))}
              </span>
            );
          return (
            <Link
              key={d}
              href={`/seguimientos/nuevo?origin=${direction.slice(0, 3)}&out=${d}`}
              title={`${fechaCorta(d)}: ${AEROLINEA[c.airline]} ${eur(c.price)}${c.other ? ` · ${AEROLINEA[c.other.airline]} ${eur(c.other.price)}` : ""}`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-md leading-tight ${color(c.ratio)}`}
            >
              <span className="text-[9px] opacity-80">{isFirst ? fechaCorta(d) : Number(d.slice(8))}</span>
              <span className="text-[11px] font-semibold tabular-nums">{Math.round(c.price)}</span>
              <span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${c.airline === "VY" ? "bg-vy" : "bg-fr"}`} />
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-600" />Muy barato</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-100" />Normal</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-300" />Caro</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-vy" />Vueling</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-fr" />Ryanair</span>
      </div>
      <p className="text-[11px] text-muted">Precio más barato del día (un trayecto, 1 persona). Toca un día para vigilarlo.</p>
    </section>
  );
}
