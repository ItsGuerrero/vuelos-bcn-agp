import { describe, expect, it } from "vitest";
import { autoIntervalHours, isScanHour } from "../src/lib/core/schedule";
import { planBudget } from "../src/lib/core/budget";
import { monthsInRange, nowInZone } from "../src/lib/core/dates";

describe("frecuencia inteligente", () => {
  it.each([
    [90, 24],
    [61, 24],
    [60, 12],
    [21, 12],
    [20, 7],
    [1, 7],
  ])("%i días → cada %i h", (days, hours) => {
    expect(autoIntervalHours(days)).toBe(hours);
  });

  it("detecta la hora de escaneo", () => {
    expect(isScanHour(9, ["09:00", "21:00"])).toBe(true);
    expect(isScanHour(10, ["09:00", "21:00"])).toBe(false);
  });
});

describe("presupuesto de SerpApi", () => {
  const base = {
    monthlyLimit: 250,
    usedToday: { flash: 0, trackers: 0, manual: 0 },
    daysInMonth: 30,
    scansPerDayConfigured: 2,
    callsPerScan: 2,
    detailCapPerDay: 3,
  };

  it("a principio de mes: 2 escaneos y 3 detalles al día", () => {
    const p = planBudget({ ...base, usedBeforeToday: 0, dayOfMonth: 1 });
    expect(p.scansAllowedToday).toBe(2);
    expect(p.detailCallsRemainingToday).toBe(3);
    expect(p.degraded).toBe(false);
  });

  it("si vamos justos, baja a 1 escaneo y menos detalles", () => {
    const p = planBudget({ ...base, usedBeforeToday: 200, dayOfMonth: 20 });
    // quedan 237-200 = 37 para 11 días → 3 al día
    expect(p.dailyAllowance).toBe(3);
    expect(p.scansAllowedToday).toBe(1);
    expect(p.detailCallsRemainingToday).toBe(1);
    expect(p.degraded).toBe(true);
  });

  it("descuenta lo ya gastado hoy", () => {
    const p = planBudget({ ...base, usedBeforeToday: 0, dayOfMonth: 1, usedToday: { flash: 2, trackers: 2, manual: 0 } });
    expect(p.scansRemainingToday).toBe(1);
    expect(p.detailCallsRemainingToday).toBe(1);
  });

  it("sin presupuesto no se hace nada", () => {
    const p = planBudget({ ...base, usedBeforeToday: 250, dayOfMonth: 15 });
    expect(p.scansRemainingToday).toBe(0);
    expect(p.detailCallsRemainingToday).toBe(0);
  });
});

describe("fechas", () => {
  it("meses de un rango", () => {
    expect(monthsInRange("2026-11-25", "2027-02-22")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
  });
  it("hora local de Madrid", () => {
    const z = nowInZone("Europe/Madrid", new Date("2026-11-25T23:30:00Z"));
    expect(z.date).toBe("2026-11-26");
    expect(z.time).toBe("00:30");
    expect(z.daysInMonth).toBe(30);
  });
});
