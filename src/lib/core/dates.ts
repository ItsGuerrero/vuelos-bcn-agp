/** Utilidades de fechas en formato YYYY-MM-DD (sin zonas horarias). */

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Fecha y hora actuales en una zona horaria: { date: "YYYY-MM-DD", time: "HH:MM", dayOfMonth, daysInMonth }. */
export function nowInZone(timeZone = "Europe/Madrid", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    hour: Number(get("hour")),
    dayOfMonth: day,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    monthStart: `${get("year")}-${get("month")}-01`,
  };
}

/** Primer día de cada mes que toca el rango [from, to]. */
export function monthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  let cur = `${from.slice(0, 7)}-01`;
  while (cur <= to) {
    months.push(cur);
    const d = new Date(`${cur}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return months;
}
