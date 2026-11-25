import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getCoupleProfiles, getTracker } from "@/lib/data";
import { addDays, nowInZone } from "@/lib/core/dates";
import { Page, Skeleton } from "@/components/ui";
import { TrackerForm, type TrackerFormValues } from "@/components/TrackerForm";

export default function NuevoPage(props: PageProps<"/seguimientos/nuevo">) {
  return (
    <Page title="Nuevo seguimiento" back="/">
      <Suspense fallback={<Skeleton lines={2} />}>
        <NewTracker searchParams={props.searchParams} />
      </Suspense>
    </Page>
  );
}

async function NewTracker({ searchParams }: { searchParams: PageProps<"/seguimientos/nuevo">["searchParams"] }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.coupleId) redirect("/pareja");
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : null;
  const invert = sp.invert === "1";

  const today = nowInZone().date;
  const profiles = await getCoupleProfiles();
  const me = profiles.find((p) => p.id === s.userId);

  let initial: TrackerFormValues = {
    origin: me?.home_airport ?? "AGP",
    outbound_date: addDays(today, 14),
    return_date: addDays(today, 17),
    flex_days: 0,
    passengers: 1,
    traveler_id: null,
    target_price: null,
    check_interval_hours: null,
    with_baggage: true,
    time_filters: {},
    notes: null,
  };

  // Desde una oferta o el mapa de calor: origen y fecha de ida concretos.
  const qOrigin = sp.origin === "BCN" || sp.origin === "AGP" ? sp.origin : null;
  const qOut = typeof sp.out === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.out) && sp.out >= today ? sp.out : null;
  if (qOrigin) initial.origin = qOrigin;
  if (qOut) {
    initial.outbound_date = qOut;
    initial.return_date = addDays(qOut, 3);
  }

  // "Repetir el viaje anterior" e "Invertir sentido" parten de otro seguimiento.
  if (from) {
    const prev = await getTracker(from);
    if (prev) {
      const t = prev.tracker;
      const past = t.outbound_date < today;
      const span = t.return_date ? Math.round((Date.parse(t.return_date) - Date.parse(t.outbound_date)) / 86_400_000) : null;
      const out = past ? addDays(today, 14) : t.outbound_date;
      initial = {
        origin: invert ? t.destination : t.origin,
        outbound_date: out,
        return_date: span === null ? null : addDays(out, span),
        flex_days: t.flex_days,
        passengers: t.passengers,
        traveler_id: t.traveler_id,
        target_price: t.target_price === null ? null : Number(t.target_price),
        check_interval_hours: t.check_interval_hours,
        with_baggage: t.with_baggage,
        time_filters: invert ? { outbound: t.time_filters?.return, return: t.time_filters?.outbound } : t.time_filters,
        notes: null,
      };
    }
  }

  const people = profiles.map((p) => ({ id: p.id, name: p.id === s.userId ? `${p.display_name ?? "Yo"} (yo)` : p.display_name ?? "Pareja" }));
  return <TrackerForm initial={initial} people={people} minDate={today} />;
}
