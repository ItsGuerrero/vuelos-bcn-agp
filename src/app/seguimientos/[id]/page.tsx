import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { checkTotal, getCoupleProfiles, getTracker, type PriceCheck, type Tracker } from "@/lib/data";
import type { Combo, DateMatrix } from "@/lib/core/combos";
import type { Airport, Flight } from "@/lib/types";
import { trackerLight } from "@/lib/core/light";
import { AEROLINEA, enCuanto, eur, fechaConDia, fechaCorta, fechaHora, haceCuanto, rangoFechas } from "@/lib/format";
import { buyLink } from "@/lib/links";
import { AirlineBadge, Delta, Page, Semaforo, Skeleton } from "@/components/ui";
import { PriceChart, type ChartPoint } from "@/components/PriceChart";
import { CheckNowButton, MoreActions, PurchaseForm } from "@/components/TrackerActions";

export const maxDuration = 60;

export default function DetallePage(props: PageProps<"/seguimientos/[id]">) {
  return (
    <Suspense
      fallback={
        <Page title="Seguimiento" back="/">
          <Skeleton />
        </Page>
      }
    >
      <Detail params={props.params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: PageProps<"/seguimientos/[id]">["params"] }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.coupleId) redirect("/pareja");
  const [data, profiles] = await Promise.all([getTracker(id), getCoupleProfiles()]);
  if (!data) notFound();
  const { tracker: t, checks } = data;

  const last = checks[0] ?? null;
  const current = last ? checkTotal(last, t.with_baggage) : null;
  const previous = checks[1] ? checkTotal(checks[1], t.with_baggage) : null;
  const lowest = t.lowest_price === null ? null : Number(t.lowest_price);
  const light = trackerLight({ status: t.status, current, lowest, target: t.target_price === null ? null : Number(t.target_price) });
  const traveler = t.traveler_id ? profiles.find((p) => p.id === t.traveler_id)?.display_name ?? "—" : "Los dos";

  return (
    <Page title={`${t.origin} ${t.return_date ? "⇄" : "→"} ${t.destination} · ${rangoFechas(t.outbound_date, t.return_date)}`} back="/">
      {/* Resumen */}
      <section className="card space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted">{t.status === "purchased" ? "Pagado" : "Mejor precio ahora"}</p>
            <p className="text-4xl font-bold tabular-nums">
              {eur(t.status === "purchased" ? t.purchased_price : current)}
            </p>
            {t.status === "active" && <Delta current={current} previous={previous} />}
          </div>
          <div className="space-y-1 text-right text-sm">
            <p>
              <span className="text-muted">Mínimo </span>
              <b>{eur(lowest)}</b>
            </p>
            {t.target_price !== null && (
              <p>
                <span className="text-muted">Objetivo </span>
                <b>{eur(t.target_price)}</b>
              </p>
            )}
          </div>
        </div>
        <Semaforo light={light.light} label={light.label} />
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="chip">👥 {t.passengers} {t.passengers === 1 ? "pasajero" : "pasajeros"}</span>
          <span className="chip">🧳 {t.with_baggage ? "Con equipaje" : "Sin equipaje"}</span>
          {t.flex_days > 0 && <span className="chip">± {t.flex_days} días</span>}
          <span className="chip">Viaja: {traveler}</span>
          {t.time_filters?.outbound && <span className="chip">Ida {horario(t.time_filters.outbound)}</span>}
          {t.time_filters?.return && <span className="chip">Vuelta {horario(t.time_filters.return)}</span>}
        </div>
        {t.status === "active" && (
          <p className="text-xs text-muted">
            {t.last_checked_at ? `Comprobado ${haceCuanto(t.last_checked_at)}` : "Aún sin comprobar"} · Próxima {enCuanto(t.next_check_at)}
          </p>
        )}
        {t.notes && <p className="text-sm italic text-muted">“{t.notes}”</p>}
      </section>

      {/* Combinación actual */}
      {last?.best_combo && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Mejor combinación</h2>
          <ComboCard combo={last.best_combo} tracker={t} highlight />
          {last.best_total !== last.best_total_bags && (
            <p className="px-1 text-xs text-muted">
              Precio base {eur(last.best_total)} · con nuestro equipaje {eur(last.best_total_bags)}
            </p>
          )}
        </section>
      )}

      {/* Acciones */}
      {t.status === "active" && (
        <section className="space-y-2">
          <PurchaseForm id={t.id} suggested={current} />
          <CheckNowButton id={t.id} />
        </section>
      )}

      {/* Gráfica */}
      <section className="card space-y-2">
        <h2 className="font-semibold">Evolución del precio</h2>
        <PriceChart data={chartData(checks, t)} lowest={lowest} />
      </section>

      {/* Matriz de fechas */}
      {last?.date_matrix && <MatrixCard m={last.date_matrix} />}

      {/* Alternativas */}
      {last?.alternatives && last.alternatives.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Siguientes alternativas</h2>
          {last.alternatives.map((c, i) => (
            <ComboCard key={i} combo={c} tracker={t} />
          ))}
        </section>
      )}

      {/* Histórico */}
      <ChecksTable checks={checks} tracker={t} />

      <MoreActions id={t.id} status={t.status} />
      <p className="pb-4 text-center text-[11px] text-muted">
        La app nunca compra: los enlaces abren la web de la aerolínea. Los precios pueden cambiar al reservar.
      </p>
    </Page>
  );
}

function horario(w: { after?: string; before?: string }) {
  if (w.after && w.before) return `${w.after}–${w.before}`;
  return w.after ? `desde ${w.after}` : `hasta ${w.before}`;
}

function LegRow({ f, label, origin, dest, passengers }: { f: Flight; label: string; origin: Airport; dest: Airport; passengers: number }) {
  return (
    <div className="flex items-center gap-3">
      <AirlineBadge airline={f.airline} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {label} · {fechaConDia(f.date)}
        </p>
        <p className="text-xs text-muted">
          {f.fromCalendar
            ? `${AEROLINEA[f.airline]} · precio mínimo del día (sin detalle de horario)`
            : `${f.flightNumber ?? AEROLINEA[f.airline]} · ${f.depTime ?? "?"} → ${f.arrTime ?? "?"}`}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums">{eur(f.price)}</p>
        <a
          href={buyLink({ airline: f.airline, origin, dest, date: f.date, passengers })}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-accent"
        >
          Ver en {AEROLINEA[f.airline]} ↗
        </a>
      </div>
    </div>
  );
}

function ComboCard({ combo, tracker: t, highlight }: { combo: Combo; tracker: Tracker; highlight?: boolean }) {
  return (
    <div className={`card space-y-3 ${highlight ? "ring-2 ring-accent/30" : ""}`}>
      <LegRow f={combo.outbound} label="Ida" origin={t.origin} dest={t.destination} passengers={t.passengers} />
      {combo.return && <LegRow f={combo.return} label="Vuelta" origin={t.destination} dest={t.origin} passengers={t.passengers} />}
      <div className="flex justify-between border-t border-border pt-2 text-sm">
        <span className="text-muted">
          Total{t.passengers > 1 ? ` (${t.passengers} pasajeros)` : ""}
        </span>
        <b className="tabular-nums">{eur(t.with_baggage ? combo.totalWithBags : combo.baseTotal)}</b>
      </div>
    </div>
  );
}

function MatrixCard({ m }: { m: DateMatrix }) {
  const all = m.cells.flat().filter((v): v is number => v !== null);
  if (!all.length) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const shade = (v: number) => {
    const k = max === min ? 0 : (v - min) / (max - min);
    return `hsl(${140 - 140 * k} 70% ${matrixLightness(k)}%)`;
  };
  return (
    <section className="card space-y-2">
      <h2 className="font-semibold">Fechas alternativas</h2>
      <p className="text-xs text-muted">Filas: ida · Columnas: vuelta. Verde = más barato.</p>
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full border-separate border-spacing-1 text-center text-xs tabular-nums">
          <thead>
            <tr>
              <th />
              {m.returnDates.map((d) => (
                <th key={d} className="font-medium text-muted">
                  {fechaCorta(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.outboundDates.map((od, i) => (
              <tr key={od}>
                <th className="whitespace-nowrap pr-1 text-left font-medium text-muted">{fechaCorta(od)}</th>
                {m.cells[i].map((v, j) => {
                  const best = m.best && m.best.outboundDate === od && m.best.returnDate === m.returnDates[j];
                  return (
                    <td
                      key={j}
                      className={`rounded-md px-1 py-1.5 ${best ? "font-bold ring-2 ring-emerald-600" : ""} ${v === null ? "text-muted" : "text-black"}`}
                      style={v === null ? undefined : { background: shade(v) }}
                    >
                      {v === null ? "—" : Math.round(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {m.best && (
        <p className="text-sm">
          Lo más barato: ida <b>{fechaCorta(m.best.outboundDate)}</b> y vuelta <b>{fechaCorta(m.best.returnDate)}</b> por{" "}
          <b>{eur(m.best.total)}</b>
        </p>
      )}
    </section>
  );
}

// Luminosidad fija (la tabla usa texto negro sobre colores pastel en ambos temas).
function matrixLightness(k: number) {
  return 82 - 4 * k;
}

function ChecksTable({ checks, tracker: t }: { checks: PriceCheck[]; tracker: Tracker }) {
  if (!checks.length) return null;
  const rows = checks.slice(0, 30);
  return (
    <section className="card space-y-2">
      <h2 className="font-semibold">Comprobaciones</h2>
      <ul className="divide-y divide-border text-sm">
        {rows.map((c, i) => {
          const total = checkTotal(c, t.with_baggage);
          const prev = rows[i + 1] ? checkTotal(rows[i + 1], t.with_baggage) : null;
          return (
            <li key={c.id} className="flex items-center gap-2 py-2">
              <span className="w-28 shrink-0 text-xs text-muted">{fechaHora(c.checked_at)}</span>
              <span className="flex flex-1 gap-1">
                {c.best_combo && <AirlineBadge airline={c.best_combo.outbound.airline} />}
                {c.best_combo?.return && <AirlineBadge airline={c.best_combo.return.airline} />}
                {c.errors?.length ? <span title={c.errors.map((e) => e.message).join("\n")}>⚠️</span> : null}
              </span>
              <span className="w-16 text-right"><Delta current={total} previous={prev} /></span>
              <span className="w-16 text-right font-semibold tabular-nums">{eur(total)}</span>
            </li>
          );
        })}
      </ul>
      {checks.length > rows.length && <p className="text-xs text-muted">Mostrando las 30 últimas de {checks.length}.</p>}
    </section>
  );
}

function chartData(checks: PriceCheck[], t: Tracker): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const c of checks) {
    const v = checkTotal(c, t.with_baggage);
    if (v !== null) points.push({ t: new Date(c.checked_at).getTime(), nuestro: v });
  }
  // price_history de Google (último disponible de cada trayecto). Viene en [timestamp en segundos, precio].
  const withInsights = checks.find((c) => c.insights?.outbound?.priceHistory?.length || c.insights?.return?.priceHistory?.length);
  if (withInsights?.insights) {
    for (const [ts, price] of withInsights.insights.outbound?.priceHistory ?? []) points.push({ t: ts * 1000, googleIda: price });
    for (const [ts, price] of withInsights.insights.return?.priceHistory ?? []) points.push({ t: ts * 1000, googleVuelta: price });
  }
  return points.sort((a, b) => a.t - b.t);
}
