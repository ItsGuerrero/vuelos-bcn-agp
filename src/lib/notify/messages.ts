import type { Combo } from "../core/combos";
import type { Airport, Flight } from "../types";
import { AEROLINEA, eur, rangoFechas } from "../format";
import { buyLink } from "../links";

/** Mensajes de Telegram (HTML). Funciones puras para poder testearlas. */

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface InlineButton {
  text: string;
  url: string;
}

export interface TelegramMessage {
  text: string;
  buttons: InlineButton[][];
}

export interface TrackerInfo {
  id: string;
  origin: Airport;
  destination: Airport;
  outbound_date: string;
  return_date: string | null;
  passengers: number;
  target_price: number | null;
}

const legText = (f: Flight) =>
  f.fromCalendar ? `${AEROLINEA[f.airline]} (horario por confirmar)` : `${AEROLINEA[f.airline]} ${f.depTime ?? ""}`.trim();

export function comboText(c: Combo): string {
  return c.return ? `ida ${legText(c.outbound)} + vuelta ${legText(c.return)}` : legText(c.outbound);
}

export function routeTitle(t: TrackerInfo): string {
  return `${t.origin}${t.return_date ? "⇄" : "→"}${t.destination} (${rangoFechas(t.outbound_date, t.return_date)})`;
}

export function buyButtons(t: TrackerInfo, c: Combo, appUrl: string): InlineButton[][] {
  const legs: Array<{ f: Flight; origin: Airport; dest: Airport; label: string }> = [
    { f: c.outbound, origin: t.origin, dest: t.destination, label: c.return ? "Ida" : "Comprar" },
  ];
  if (c.return) legs.push({ f: c.return, origin: t.destination, dest: t.origin, label: "Vuelta" });
  const row = legs.map((l) => ({
    text: `${l.label}: ${AEROLINEA[l.f.airline]} ↗`,
    url: buyLink({ airline: l.f.airline, origin: l.origin, dest: l.dest, date: l.f.date, passengers: t.passengers }),
  }));
  return [row, [{ text: "Ver en la app", url: `${appUrl}/seguimientos/${t.id}` }]];
}

export function newLowMessage(opts: {
  tracker: TrackerInfo;
  combo: Combo;
  total: number;
  drop: number;
  appUrl: string;
  /** Línea de predicción (fase 5). */
  prediction?: string;
}): TelegramMessage {
  const { tracker: t, combo, total, drop } = opts;
  const lines = [
    `🟢 <b>Nuevo mínimo ${esc(routeTitle(t))}: ${eur(total)}</b>`,
    esc(`(${comboText(combo)})`),
    `Ha bajado ${eur(drop)} desde el anterior mínimo.`,
  ];
  if (t.passengers > 1) lines.push(`Total para ${t.passengers} pasajeros.`);
  if (opts.prediction) lines.push(esc(opts.prediction));
  return { text: lines.join("\n"), buttons: buyButtons(t, combo, opts.appUrl) };
}

export function targetPriceMessage(opts: {
  tracker: TrackerInfo;
  combo: Combo;
  total: number;
  isNewLow: boolean;
  appUrl: string;
  prediction?: string;
}): TelegramMessage {
  const { tracker: t, combo, total } = opts;
  const lines = [
    `🎯 <b>Precio objetivo alcanzado ${esc(routeTitle(t))}: ${eur(total)}</b>`,
    `Tu objetivo era ${eur(t.target_price)}.${opts.isNewLow ? " Además es el precio más bajo desde que lo vigilamos." : ""}`,
    esc(`(${comboText(combo)})`),
  ];
  if (t.passengers > 1) lines.push(`Total para ${t.passengers} pasajeros.`);
  if (opts.prediction) lines.push(esc(opts.prediction));
  return { text: lines.join("\n"), buttons: buyButtons(t, combo, opts.appUrl) };
}
