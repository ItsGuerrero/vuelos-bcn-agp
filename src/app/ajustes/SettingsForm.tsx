"use client";

import { useActionState, useState, useTransition } from "react";
import { muteFlash, saveSettings, type ActionState } from "../actions";

export interface SettingsValues {
  vy_label: string;
  vy_price: number;
  fr_label: string;
  fr_price: number;
  new_low_min_drop_eur: number;
  new_low_min_drop_pct: number;
  telegram: boolean;
  daily_summary: boolean;
  flash_enabled_anomaly: boolean;
  flash_enabled_threshold: boolean;
  flash_min_dates_pct: number;
  flash_min_drop_pct: number;
  flash_threshold_price: number;
  flash_horizon_days: number;
  scan_1: string;
  scan_2: string;
  flash_muted_until: string | null;
  monthlyLimit: number;
}

const HOURS = Array.from({ length: 18 }, (_, i) => `${String(i + 6).padStart(2, "0")}:00`);

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-start justify-between gap-3 text-sm">
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
    </label>
  );
}

function NumberField({ name, label, suffix, defaultValue, min, max, step = 1 }: { name: string; label: string; suffix: string; defaultValue: number; min: number; max: number; step?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" inputMode="decimal" name={name} defaultValue={defaultValue} min={min} max={max} step={step} className="input" />
        <span className="text-sm text-muted">{suffix}</span>
      </div>
    </label>
  );
}

export function SettingsForm({ v }: { v: SettingsValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSettings, {});
  const [scan2, setScan2] = useState(v.scan_2);
  const [mutePending, startMute] = useTransition();
  const muted = v.flash_muted_until !== null && new Date(v.flash_muted_until) > new Date();
  const scansPerDay = scan2 ? 2 : 1;
  const flashPerMonth = scansPerDay * 2 * 30;

  return (
    <form action={action} className="space-y-4">
      <section className="card space-y-3">
        <h2 className="font-semibold">🧳 Nuestro equipaje</h2>
        <p className="text-xs text-muted">Coste por trayecto y pasajero. Los seguimientos con «equipaje incluido» lo suman al comparar.</p>
        {(["vy", "fr"] as const).map((a) => (
          <div key={a} className="grid grid-cols-[1fr_6.5rem] gap-2">
            <label className="field">
              <span>{a === "vy" ? "Vueling" : "Ryanair"}</span>
              <input name={`${a}_label`} defaultValue={a === "vy" ? v.vy_label : v.fr_label} className="input" placeholder="Maleta de cabina" />
            </label>
            <label className="field">
              <span>€</span>
              <input type="number" inputMode="decimal" step="0.5" min={0} name={`${a}_price`} defaultValue={a === "vy" ? v.vy_price : v.fr_price} className="input" />
            </label>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">🔔 Avisos</h2>
        <Toggle name="telegram" label="Avisos por Telegram" defaultChecked={v.telegram} hint="Si lo desactivas, los avisos se guardan pero no se envían." />
        <Toggle name="daily_summary" label="Resumen diario" defaultChecked={v.daily_summary} hint="Cada mañana a las 9:00, el estado de vuestros viajes." />
        <p className="text-sm font-medium">Avisar de un nuevo mínimo cuando baje al menos…</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField name="new_low_min_drop_eur" label="Euros" suffix="€" defaultValue={v.new_low_min_drop_eur} min={0} max={100} />
          <NumberField name="new_low_min_drop_pct" label="o porcentaje" suffix="%" defaultValue={v.new_low_min_drop_pct} min={0} max={50} step={0.5} />
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">🔥 Detector de ofertas</h2>
        <Toggle name="flash_enabled_anomaly" label="Rebajas generales" defaultChecked={v.flash_enabled_anomaly} hint="Muchas fechas de una aerolínea bajan a la vez." />
        <div className="grid grid-cols-2 gap-3">
          <NumberField name="flash_min_dates_pct" label="Fechas rebajadas" suffix="%" defaultValue={v.flash_min_dates_pct} min={5} max={100} />
          <NumberField name="flash_min_drop_pct" label="Bajada mínima" suffix="%" defaultValue={v.flash_min_drop_pct} min={5} max={90} />
        </div>
        <Toggle name="flash_enabled_threshold" label="Precio chollo" defaultChecked={v.flash_enabled_threshold} hint="Cualquier trayecto por debajo de este precio." />
        <NumberField name="flash_threshold_price" label="Precio chollo" suffix="€ por trayecto" defaultValue={v.flash_threshold_price} min={5} max={200} />
        <label className="field">
          <span>Días que se vigilan</span>
          <select name="flash_horizon_days" defaultValue={v.flash_horizon_days} className="input">
            <option value={30}>Próximos 30 días</option>
            <option value={60}>Próximos 60 días</option>
            <option value={90}>Próximos 90 días</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>Escaneo</span>
            <select name="scan_1" defaultValue={v.scan_1} className="input">
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Segundo escaneo</span>
            <select name="scan_2" value={scan2} onChange={(e) => setScan2(e.target.value)} className="input">
              <option value="">Ninguno</option>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">
          El escaneo gasta 2 búsquedas de Google Flights (una por sentido): ~{flashPerMonth} de {v.monthlyLimit} al mes. Ryanair no gasta
          búsquedas.
        </p>
      </section>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Guardando…" : "Guardar ajustes"}
      </button>

      <section className="card space-y-2">
        <h2 className="font-semibold">🔕 Silenciar avisos de ofertas</h2>
        {muted ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              Silenciadas hasta el{" "}
              {new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(
                new Date(v.flash_muted_until!),
              )}
            </span>
            <button type="button" className="chip" disabled={mutePending} onClick={() => startMute(() => muteFlash(0))}>
              Reactivar
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[1, 3, 7].map((d) => (
              <button key={d} type="button" className="chip" disabled={mutePending} onClick={() => startMute(() => muteFlash(d))}>
                {d} {d === 1 ? "día" : "días"}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">El detector sigue funcionando y guardando las ofertas; solo deja de enviar avisos.</p>
      </section>
    </form>
  );
}
