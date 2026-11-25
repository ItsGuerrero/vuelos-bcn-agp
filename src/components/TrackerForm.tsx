"use client";

import { useActionState, useState } from "react";
import { saveTracker, type ActionState } from "@/app/actions";
import type { Airport, TimeFilters } from "@/lib/types";

export interface TrackerFormValues {
  id?: string;
  origin: Airport;
  outbound_date: string;
  return_date: string | null;
  flex_days: number;
  passengers: number;
  traveler_id: string | null;
  target_price: number | null;
  check_interval_hours: number | null;
  with_baggage: boolean;
  time_filters: TimeFilters;
  notes: string | null;
}

export function TrackerForm({
  initial,
  people,
  minDate,
}: {
  initial: TrackerFormValues;
  people: Array<{ id: string; name: string }>;
  minDate: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTracker, {});
  const [origin, setOrigin] = useState<Airport>(initial.origin);
  const [oneWay, setOneWay] = useState(initial.id ? initial.return_date === null : false);
  const [outDate, setOutDate] = useState(initial.outbound_date);
  const dest: Airport = origin === "BCN" ? "AGP" : "BCN";
  const tf = initial.time_filters ?? {};
  const hasAdvanced = Boolean(tf.outbound || tf.return || initial.target_price || initial.check_interval_hours || initial.notes);

  return (
    <form action={action} className="space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="origin" value={origin} />

      <div className="card space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-background p-3">
          <div>
            <p className="text-xs text-muted">Desde</p>
            <p className="text-xl font-semibold">{origin === "BCN" ? "Barcelona" : "Málaga"}</p>
          </div>
          <button
            type="button"
            onClick={() => setOrigin(dest)}
            className="rounded-full border border-border bg-surface px-3 py-2 text-lg"
            aria-label="Invertir sentido"
            title="Invertir sentido"
          >
            ⇄
          </button>
          <div className="text-right">
            <p className="text-xs text-muted">Hasta</p>
            <p className="text-xl font-semibold">{dest === "BCN" ? "Barcelona" : "Málaga"}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>Ida</span>
            <input
              type="date"
              name="outbound_date"
              className="input"
              min={minDate}
              value={outDate}
              onChange={(e) => setOutDate(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Vuelta</span>
            <input
              type="date"
              name="return_date"
              className="input disabled:opacity-40"
              min={outDate || minDate}
              defaultValue={initial.return_date ?? ""}
              disabled={oneWay}
              required={!oneWay}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="one_way" checked={oneWay} onChange={(e) => setOneWay(e.target.checked)} className="h-4 w-4" />
          Solo ida
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>Pasajeros</span>
            <select name="passengers" className="input" defaultValue={initial.passengers}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Flexibilidad</span>
            <select name="flex_days" className="input" defaultValue={initial.flex_days}>
              <option value={0}>Fechas exactas</option>
              <option value={1}>± 1 día</option>
              <option value={2}>± 2 días</option>
              <option value={3}>± 3 días</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>¿Quién viaja?</span>
          <select name="traveler_id" className="input" defaultValue={initial.traveler_id ?? ""}>
            <option value="">Los dos</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="card group" open={hasAdvanced}>
        <summary className="cursor-pointer list-none font-medium">
          <span className="inline-block transition group-open:rotate-90">›</span> Más opciones
        </summary>
        <div className="mt-4 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Horario de la ida</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className="field">
                <span className="text-xs text-muted">No antes de</span>
                <input type="time" name="out_after" className="input" defaultValue={tf.outbound?.after ?? ""} />
              </label>
              <label className="field">
                <span className="text-xs text-muted">No después de</span>
                <input type="time" name="out_before" className="input" defaultValue={tf.outbound?.before ?? ""} />
              </label>
            </div>
          </fieldset>
          {!oneWay && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Horario de la vuelta</legend>
              <div className="grid grid-cols-2 gap-3">
                <label className="field">
                  <span className="text-xs text-muted">No antes de</span>
                  <input type="time" name="ret_after" className="input" defaultValue={tf.return?.after ?? ""} />
                </label>
                <label className="field">
                  <span className="text-xs text-muted">No después de</span>
                  <input type="time" name="ret_before" className="input" defaultValue={tf.return?.before ?? ""} />
                </label>
              </div>
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="field">
              <span>Precio objetivo (€)</span>
              <input
                type="number"
                inputMode="decimal"
                step="1"
                min="1"
                name="target_price"
                className="input"
                placeholder="Opcional"
                defaultValue={initial.target_price ?? ""}
              />
            </label>
            <label className="field">
              <span>Comprobar</span>
              <select name="check_interval_hours" className="input" defaultValue={initial.check_interval_hours ?? ""}>
                <option value="">Automático</option>
                <option value={6}>Cada 6 h</option>
                <option value={12}>Cada 12 h</option>
                <option value={24}>Cada 24 h</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="with_baggage" defaultChecked={initial.with_baggage} className="h-4 w-4" />
            Comparar con nuestro equipaje incluido
          </label>
          <label className="field">
            <span>Nota</span>
            <input name="notes" className="input" maxLength={200} placeholder="Ej.: puente de diciembre" defaultValue={initial.notes ?? ""} />
          </label>
        </div>
      </details>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? (initial.id ? "Guardando…" : "Creando y comprobando precios…") : initial.id ? "Guardar cambios" : "Empezar a vigilar"}
      </button>
    </form>
  );
}
