import { addDays } from "./dates";

/**
 * Temporada alta y festivos relevantes para BCN⇄AGP (nacionales + Andalucía + Cataluña).
 * Devuelve el nombre de la temporada si la fecha cae dentro (con margen para los puentes).
 */

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface Season {
  name: string;
  from: string; // MM-DD o fecha completa
  to: string;
}

function seasonsFor(year: number): Season[] {
  const easter = easterSunday(year);
  const y = (md: string) => `${year}-${md}`;
  return [
    { name: "Navidad", from: y("12-19"), to: y("12-31") },
    { name: "Navidad y Reyes", from: y("01-01"), to: y("01-07") },
    { name: "Semana Santa", from: addDays(easter, -9), to: addDays(easter, 1) },
    { name: "el puente de la Constitución", from: y("12-04"), to: y("12-09") },
    { name: "el puente de Todos los Santos", from: y("10-30"), to: y("11-02") },
    { name: "el puente del Pilar", from: y("10-10"), to: y("10-13") },
    { name: "el puente de mayo", from: y("04-29"), to: y("05-03") },
    { name: "el Día de Andalucía", from: y("02-26"), to: y("03-01") },
    { name: "Sant Joan", from: y("06-22"), to: y("06-25") },
    { name: "la Diada", from: y("09-09"), to: y("09-12") },
    { name: "la Mercè", from: y("09-22"), to: y("09-25") },
    { name: "la Feria de Málaga", from: y("08-12"), to: y("08-24") },
    { name: "verano", from: y("07-01"), to: y("08-31") },
  ];
}

/** Temporada alta en la que cae alguna de las fechas (la primera que coincida). */
export function highSeason(dates: string[]): string | null {
  for (const date of dates) {
    const year = Number(date.slice(0, 4));
    for (const s of seasonsFor(year)) {
      if (date >= s.from && date <= s.to) return s.name;
    }
  }
  return null;
}
