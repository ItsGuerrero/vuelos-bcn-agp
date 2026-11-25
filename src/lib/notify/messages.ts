import type { Combo } from "../core/combos";
import type { DetectedSale, SaleItem } from "../core/flash";
import type { Airline, Airport, Direction, Flight } from "../types";
import { AEROLINEA, eur, fechaCorta as fc, rangoFechas } from "../format";
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

export function riseRiskMessage(opts: {
  tracker: TrackerInfo;
  combo: Combo;
  total: number;
  lowest: number;
  appUrl: string;
  prediction: { probability: number; reasons: string[] };
}): TelegramMessage {
  const { tracker: t, combo, total } = opts;
  const lines = [
    `⚠️ <b>Riesgo de subida ${esc(routeTitle(t))}: ${eur(total)}</b>`,
    total <= opts.lowest ? "Está en su precio más bajo y es probable que empiece a subir." : `Está cerca del mínimo (${eur(opts.lowest)}) y es probable que suba.`,
    esc(`(${comboText(combo)})`),
    `Probabilidad de que baje más: ~${opts.prediction.probability} %.`,
    ...opts.prediction.reasons.slice(0, 3).map((r) => `• ${esc(r)}`),
    "Recomendación: <b>comprar ya</b>.",
  ];
  return { text: lines.join("\n"), buttons: buyButtons(t, combo, opts.appUrl) };
}

// ---------------------------------------------------------------------
// Ofertas flash
// ---------------------------------------------------------------------

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function monthSpan(dates: string[]): string {
  const sorted = [...dates].sort();
  const m1 = Number(sorted[0].slice(5, 7)) - 1;
  const m2 = Number(sorted[sorted.length - 1].slice(5, 7)) - 1;
  return m1 === m2 ? `en ${MESES_LARGOS[m1]}` : `entre ${MESES_LARGOS[m1]} y ${MESES_LARGOS[m2]}`;
}

const dirLabel = (d: Direction) => d.replace("-", "→");

function itemsLine(items: SaleItem[]): string {
  return items
    .map((i) => `${fc(i.date)} (${eur(i.price)}${i.baseline !== null ? `, suele ${eur(Math.round(i.baseline))}` : ""})`)
    .join(", ");
}

export function airlineHome(airline: Airline) {
  return airline === "VY" ? "https://www.vueling.com/es" : "https://www.ryanair.com/es/es";
}

export function flashSaleMessage(opts: {
  sale: DetectedSale;
  affected: Array<{ outbound_date: string; return_date: string | null }>;
  thresholdPrice: number;
  appUrl: string;
}): TelegramMessage {
  const { sale } = opts;
  const name = AEROLINEA[sale.airline];
  const dates = sale.items.map((i) => i.date);
  const lines: string[] = [];
  if (sale.kind === "anomaly") {
    lines.push(`🔥 <b>Parece que ${name} tiene ofertas en BCN⇄AGP</b>`);
    lines.push(
      `${sale.items.length} ${sale.items.length === 1 ? "fecha" : "fechas"} ${monthSpan(dates)} han bajado una media del ${Math.round(sale.avgDropPct ?? 0)} %.`,
    );
  } else {
    lines.push(`💸 <b>Chollo en ${name}</b>`);
    lines.push(
      `${sale.items.length} ${sale.items.length === 1 ? "trayecto" : "trayectos"} ${monthSpan(dates)} por ${eur(opts.thresholdPrice)} o menos.`,
    );
  }
  lines.push("Las más baratas:");
  for (const d of ["BCN-AGP", "AGP-BCN"] as Direction[]) {
    if (sale.cheapest[d].length) lines.push(`• ${dirLabel(d)}: ${itemsLine(sale.cheapest[d])}`);
  }
  for (const t of opts.affected.slice(0, 3)) {
    lines.push(`⚠️ Esto afecta a vuestro viaje del ${rangoFechas(t.outbound_date, t.return_date)}.`);
  }

  const first = sale.cheapest["BCN-AGP"][0] ?? sale.cheapest["AGP-BCN"][0];
  const firstDir = sale.cheapest["BCN-AGP"][0] ? "BCN-AGP" : "AGP-BCN";
  const [origin] = firstDir.split("-");
  return {
    text: lines.map((l) => (l.startsWith("🔥") || l.startsWith("💸") ? l : esc(l))).join("\n"),
    buttons: [
      [
        { text: `Ver en ${name} ↗`, url: airlineHome(sale.airline) },
        { text: "Crear seguimiento", url: `${opts.appUrl}/seguimientos/nuevo?origin=${origin}&out=${first.date}` },
      ],
      [{ text: "Ver ofertas en la app", url: `${opts.appUrl}/ofertas` }],
    ],
  };
}

// ---------------------------------------------------------------------
// Resumen diario
// ---------------------------------------------------------------------
export interface SummaryTrip {
  id: string;
  origin: string;
  destination: string;
  outbound_date: string;
  return_date: string | null;
  current: number | null;
  previous: number | null;
  lowest: number | null;
  recommendation: string | null;
}

export function dailySummaryMessage(opts: { trips: SummaryTrip[]; activeSales: number; appUrl: string }): TelegramMessage {
  const lines = ["☀️ <b>Buenos días: así están vuestros vuelos</b>"];
  if (!opts.trips.length) lines.push("No tenéis seguimientos activos.");
  for (const t of opts.trips) {
    const diff = t.current !== null && t.previous !== null ? Math.round((t.current - t.previous) * 100) / 100 : 0;
    const arrow = diff < 0 ? ` ▼${eur(-diff)}` : diff > 0 ? ` ▲${eur(diff)}` : "";
    const rec = t.recommendation ? ` · ${t.recommendation}` : "";
    lines.push(
      `• <a href="${opts.appUrl}/seguimientos/${t.id}">${t.origin}${t.return_date ? "⇄" : "→"}${t.destination} ${esc(rangoFechas(t.outbound_date, t.return_date))}</a>: ${eur(t.current)}${arrow} (mín. ${eur(t.lowest)})${esc(rec)}`,
    );
  }
  if (opts.activeSales > 0) lines.push(`🔥 Hay ${opts.activeSales} ${opts.activeSales === 1 ? "oferta activa" : "ofertas activas"} en la ruta.`);
  return { text: lines.join("\n"), buttons: [[{ text: "Abrir la app", url: opts.appUrl }]] };
}
