import { diffDays } from "./dates";

/**
 * Frecuencia "inteligente": cuanto más lejos está el vuelo, menos se comprueba.
 *  > 60 días → cada 24 h · 21–60 días → cada 12 h · < 21 días → cada 7 h.
 */
export function autoIntervalHours(daysToDeparture: number): number {
  if (daysToDeparture > 60) return 24;
  if (daysToDeparture >= 21) return 12;
  return 7;
}

export function nextCheckAt(opts: {
  today: string;
  outboundDate: string;
  customIntervalHours: number | null;
  now?: Date;
}): Date {
  const hours = opts.customIntervalHours ?? autoIntervalHours(diffDays(opts.today, opts.outboundDate));
  const now = opts.now ?? new Date();
  return new Date(now.getTime() + hours * 3_600_000);
}

/** Un seguimiento deja de comprobarse cuando ya ha pasado la fecha de ida. */
export function isExpired(today: string, outboundDate: string): boolean {
  return outboundDate < today;
}

/** ¿Toca escanear la ruta? `scanTimes` en hora local ("09:00"). El tick corre una vez por hora. */
export function isScanHour(localHour: number, scanTimes: string[]): boolean {
  return scanTimes.some((t) => Number(t.slice(0, 2)) === localHour);
}
