import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getSerpApiUsage, listTrackers, type TrackerSummary } from "@/lib/data";
import { trackerLight } from "@/lib/core/light";
import { eur, fechaCorta, haceCuanto, rangoFechas } from "@/lib/format";
import type { Flight } from "@/lib/types";
import { AirlineBadge, Delta, Page, Semaforo, Skeleton } from "@/components/ui";
import { UsageMeter } from "@/components/UsageMeter";

export default function Home() {
  return (
    <Page
      title="Nuestros viajes"
      action={
        <Link href="/seguimientos/nuevo" className="btn-primary px-3 py-2 text-sm">
          ＋ Nuevo
        </Link>
      }
    >
      <Suspense fallback={<Skeleton />}>
        <TrackerList />
      </Suspense>
    </Page>
  );
}

async function TrackerList() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.coupleId) redirect("/pareja");
  const [trackers, usage] = await Promise.all([listTrackers(), getSerpApiUsage()]);

  const active = trackers.filter((t) => t.status === "active" || t.status === "paused");
  const past = trackers.filter((t) => t.status === "purchased" || t.status === "expired");
  const spent = past.reduce((s, t) => s + Number(t.purchased_price ?? 0), 0);

  const lastTrip = [...trackers].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return (
    <div className="space-y-6">
      {lastTrip && (
        <div className="flex gap-2 overflow-x-auto text-sm">
          <Link href={`/seguimientos/nuevo?from=${lastTrip.id}`} className="chip whitespace-nowrap py-1.5">
            ⟳ Repetir el último viaje ({lastTrip.origin}→{lastTrip.destination})
          </Link>
          <Link href={`/seguimientos/nuevo?from=${lastTrip.id}&invert=1`} className="chip whitespace-nowrap py-1.5">
            ⇄ Al revés ({lastTrip.destination}→{lastTrip.origin})
          </Link>
        </div>
      )}
      {active.length === 0 ? (
        <div className="card space-y-3 text-center">
          <p className="text-3xl">🧳</p>
          <p className="font-medium">Aún no vigiláis ningún viaje</p>
          <p className="text-sm text-muted">Crea un seguimiento y os avisaremos cuando baje el precio.</p>
          <Link href="/seguimientos/nuevo" className="btn-primary">
            Crear seguimiento
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {active.map((t) => (
            <TrackerCard key={t.id} t={t} />
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Comprados y pasados</h2>
            {spent > 0 && <span className="text-xs text-muted">Gastado: {eur(spent)}</span>}
          </div>
          <ul className="space-y-3 opacity-80">
            {past.map((t) => (
              <TrackerCard key={t.id} t={t} />
            ))}
          </ul>
        </section>
      )}

      <UsageMeter usage={usage} compact />
    </div>
  );
}

function FlightLine({ label, f }: { label: string; f: Flight }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <AirlineBadge airline={f.airline} />
      <span className="w-12 text-muted">{label}</span>
      <span className="text-muted">{fechaCorta(f.date)}</span>
      <span className="ml-auto font-medium tabular-nums">
        {f.depTime && f.arrTime ? `${f.depTime} → ${f.arrTime}` : <span className="text-xs font-normal text-muted">horario pendiente</span>}
      </span>
    </p>
  );
}

function TrackerCard({ t }: { t: TrackerSummary }) {
  const lowest = t.lowest_price === null ? null : Number(t.lowest_price);
  const light = trackerLight({
    status: t.status,
    current: t.current,
    lowest,
    target: t.target_price === null ? null : Number(t.target_price),
    prediction: t.lastCheck?.prediction ?? null,
  });
  const combo = t.lastCheck?.best_combo;
  const shownPrice = t.status === "purchased" ? Number(t.purchased_price) : t.current;

  return (
    <li>
      <Link href={`/seguimientos/${t.id}`} className="card block space-y-3 active:scale-[0.99]">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-lg font-semibold">
              {t.origin} {t.return_date ? "⇄" : "→"} {t.destination}
            </p>
            <p className="text-sm text-muted">
              {rangoFechas(t.outbound_date, t.return_date)}
              {t.flex_days > 0 && ` · ±${t.flex_days} d`}
              {t.passengers > 1 && ` · ${t.passengers} pax`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums">{eur(shownPrice)}</p>
            {t.status === "active" && <Delta current={t.current} previous={t.previous} />}
          </div>
        </div>
        {combo && t.status !== "purchased" && (
          <div className="space-y-1">
            <FlightLine label="Ida" f={combo.outbound} />
            {combo.return && <FlightLine label="Vuelta" f={combo.return} />}
          </div>
        )}
        <Semaforo light={light.light} label={light.label} />
        {t.status === "active" && (
          <p className="flex justify-between text-xs text-muted">
            <span>Mínimo: {eur(lowest)}</span>
            <span>{t.last_checked_at ? `Comprobado ${haceCuanto(t.last_checked_at)}` : "Pendiente"}</span>
          </p>
        )}
      </Link>
    </li>
  );
}
