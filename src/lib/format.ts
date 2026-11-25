import type { Airline } from "./types";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export function eur(n: number | string | null | undefined, decimals?: number): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  const d = decimals ?? (Number.isInteger(v) ? 0 : 2);
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })} €`;
}

/** "2027-01-01" → "1 ene" */
export function fechaCorta(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
}

/** "2027-01-01" → "vie 1 ene" */
export function fechaConDia(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return `${DIAS[dow]} ${fechaCorta(date)}`;
}

/** Rango de fechas compacto: "1–7 ene", "28 dic – 3 ene" o "1 ene (solo ida)". */
export function rangoFechas(ida: string, vuelta: string | null): string {
  if (!vuelta) return `${fechaCorta(ida)} · solo ida`;
  const [, m1, d1] = ida.split("-").map(Number);
  const [, m2, d2] = vuelta.split("-").map(Number);
  if (m1 === m2) return `${d1}–${d2} ${MESES[m1 - 1]}`;
  return `${fechaCorta(ida)} – ${fechaCorta(vuelta)}`;
}

/** Fecha y hora en Madrid: "25 nov, 18:40". */
export function fechaHora(iso: string): string {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return f.replace(".", "");
}

export function haceCuanto(iso: string, now = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

export function enCuanto(iso: string, now = Date.now()): string {
  const min = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (min <= 0) return "en la próxima hora";
  if (min < 60) return `en ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `en ${h} h` : `en ${Math.round(h / 24)} días`;
}

export const AEROLINEA: Record<Airline, string> = { VY: "Vueling", FR: "Ryanair" };
