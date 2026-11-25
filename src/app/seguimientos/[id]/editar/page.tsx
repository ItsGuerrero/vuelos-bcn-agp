import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getCoupleProfiles, getTracker } from "@/lib/data";
import { nowInZone } from "@/lib/core/dates";
import { Page, Skeleton } from "@/components/ui";
import { TrackerForm } from "@/components/TrackerForm";

export default function EditarPage(props: PageProps<"/seguimientos/[id]/editar">) {
  return (
    <Suspense
      fallback={
        <Page title="Editar seguimiento">
          <Skeleton lines={2} />
        </Page>
      }
    >
      <Edit params={props.params} />
    </Suspense>
  );
}

async function Edit({ params }: { params: PageProps<"/seguimientos/[id]/editar">["params"] }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const [data, profiles] = await Promise.all([getTracker(id), getCoupleProfiles()]);
  if (!data) notFound();
  const t = data.tracker;
  const people = profiles.map((p) => ({ id: p.id, name: p.id === s.userId ? `${p.display_name ?? "Yo"} (yo)` : p.display_name ?? "Pareja" }));
  return (
    <Page title="Editar seguimiento" back={`/seguimientos/${id}`}>
      <p className="text-sm text-muted">
        Si cambias fechas, pasajeros u horarios, el mínimo histórico vuelve a empezar desde cero.
      </p>
      <TrackerForm
        people={people}
        minDate={nowInZone().date}
        initial={{
          id: t.id,
          origin: t.origin,
          outbound_date: t.outbound_date,
          return_date: t.return_date,
          flex_days: t.flex_days,
          passengers: t.passengers,
          traveler_id: t.traveler_id,
          target_price: t.target_price === null ? null : Number(t.target_price),
          check_interval_hours: t.check_interval_hours,
          with_baggage: t.with_baggage,
          time_filters: t.time_filters ?? {},
          notes: t.notes,
        }}
      />
    </Page>
  );
}
