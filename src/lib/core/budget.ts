/**
 * Reparto del presupuesto mensual de SerpApi.
 *
 * Cada día se calcula cuántas búsquedas "tocan" repartiendo lo que queda del mes
 * entre los días que quedan. Prioridad:
 *   1. Escaneo de la ruta (Vueling, ambos sentidos): al menos uno al día.
 *   2. Segundo escaneo del día.
 *   3. Búsquedas de detalle para los seguimientos (con tope diario).
 * Si nos acercamos al límite, la app baja sola el ritmo.
 */
export interface BudgetInput {
  monthlyLimit: number;
  /** Búsquedas usadas este mes ANTES de hoy. */
  usedBeforeToday: number;
  usedToday: { flash: number; trackers: number; manual: number };
  dayOfMonth: number;
  daysInMonth: number;
  scansPerDayConfigured: number;
  callsPerScan: number;
  detailCapPerDay: number;
  /** Margen de seguridad que no se toca (por defecto 5 %). */
  reservePct?: number;
}

export interface BudgetPlan {
  dailyAllowance: number;
  scansAllowedToday: number;
  /** Escaneos que aún se pueden hacer hoy. */
  scansRemainingToday: number;
  detailCallsRemainingToday: number;
  degraded: boolean;
  monthRemaining: number;
}

export function planBudget(b: BudgetInput): BudgetPlan {
  const reserve = Math.ceil(b.monthlyLimit * (b.reservePct ?? 0.05));
  const monthRemaining = Math.max(0, b.monthlyLimit - reserve - b.usedBeforeToday);
  const daysLeft = Math.max(1, b.daysInMonth - b.dayOfMonth + 1);
  const dailyAllowance = Math.floor(monthRemaining / daysLeft);

  const scansAllowedToday = Math.min(b.scansPerDayConfigured, Math.floor(dailyAllowance / b.callsPerScan));
  const detailAllowance = Math.min(b.detailCapPerDay, dailyAllowance - scansAllowedToday * b.callsPerScan);

  const scansDoneToday = Math.ceil(b.usedToday.flash / b.callsPerScan);
  const usedTodayTotal = b.usedToday.flash + b.usedToday.trackers + b.usedToday.manual;
  const hardLeftToday = Math.max(0, monthRemaining - usedTodayTotal);

  const scansRemainingToday = Math.max(
    0,
    Math.min(scansAllowedToday - scansDoneToday, Math.floor(hardLeftToday / b.callsPerScan)),
  );
  const detailCallsRemainingToday = Math.max(
    0,
    Math.min(detailAllowance - b.usedToday.trackers, hardLeftToday - scansRemainingToday * b.callsPerScan),
  );

  return {
    dailyAllowance,
    scansAllowedToday,
    scansRemainingToday,
    detailCallsRemainingToday,
    degraded: scansAllowedToday < b.scansPerDayConfigured || detailAllowance < b.detailCapPerDay,
    monthRemaining,
  };
}
