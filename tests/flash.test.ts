import { describe, expect, it } from "vitest";
import {
  affectedTrackers,
  computeBaselines,
  DEFAULT_FLASH_SETTINGS,
  detectFlashSales,
  shouldNotifyFlash,
  type BaselineRow,
  type ScanPoint,
} from "../src/lib/core/flash";
import { addDays } from "../src/lib/core/dates";
import type { Airline, Direction } from "../src/lib/types";

const START = "2027-01-04"; // lunes
const DAYS = 40;

/** Historial: 6 escaneos previos con un precio habitual por fecha. */
function history(airline: Airline, usual: (i: number) => number, n = 6): BaselineRow[] {
  const rows: BaselineRow[] = [];
  for (const direction of ["BCN-AGP", "AGP-BCN"] as Direction[]) {
    for (let i = 0; i < DAYS; i++) rows.push({ direction, airline, date: addDays(START, i), median: usual(i), n });
  }
  return rows;
}

/** Escaneo actual: precio habitual salvo en las fechas rebajadas. */
function scan(airline: Airline, usual: (i: number) => number, discounted: (i: number, d: Direction) => number | null): ScanPoint[] {
  const pts: ScanPoint[] = [];
  for (const direction of ["BCN-AGP", "AGP-BCN"] as Direction[]) {
    for (let i = 0; i < DAYS; i++) {
      const disc = discounted(i, direction);
      pts.push({ direction, airline, date: addDays(START, i), price: disc ?? usual(i) });
    }
  }
  return pts;
}

const usual = (i: number) => 60 + (i % 7) * 5; // 60–90 €

describe("detector de ofertas flash", () => {
  it("rebaja real: muchas fechas bajan a la vez → avisa", () => {
    // 30 de 80 fechas (37 %) bajan un 40 %.
    const points = scan("VY", usual, (i) => (i >= 10 && i < 25 ? Math.round(usual(i) * 0.6) : null));
    const { sales, warmup } = detectFlashSales({ points, baselineRows: history("VY", usual), settings: DEFAULT_FLASH_SETTINGS });
    expect(warmup.VY).toBe(false);
    const sale = sales.find((s) => s.kind === "anomaly")!;
    expect(sale).toBeDefined();
    expect(sale.airline).toBe("VY");
    expect(sale.items).toHaveLength(30);
    expect(sale.direction).toBeNull(); // los dos sentidos
    expect(sale.avgDropPct).toBeGreaterThanOrEqual(39);
    expect(sale.cheapest["BCN-AGP"]).toHaveLength(5);
    expect(sale.cheapest["BCN-AGP"][0].price).toBe(36);
  });

  it("bajada puntual: una sola fecha baja mucho → NO avisa", () => {
    const points = scan("VY", usual, (i, d) => (i === 12 && d === "BCN-AGP" ? 25 : null));
    const { sales } = detectFlashSales({
      points,
      baselineRows: history("VY", usual),
      settings: { ...DEFAULT_FLASH_SETTINGS, enabledThreshold: false },
    });
    expect(sales).toHaveLength(0);
  });

  it("pocas fechas rebajadas (por debajo del 25 %) → NO avisa", () => {
    const points = scan("FR", usual, (i, d) => (i < 8 && d === "BCN-AGP" ? 30 : null)); // 8/80 = 10 %
    const { sales } = detectFlashSales({
      points,
      baselineRows: history("FR", usual),
      settings: { ...DEFAULT_FLASH_SETTINGS, enabledThreshold: false },
    });
    expect(sales).toHaveLength(0);
  });

  it("los umbrales se pueden configurar", () => {
    const points = scan("FR", usual, (i, d) => (i < 8 && d === "BCN-AGP" ? 30 : null));
    const { sales } = detectFlashSales({
      points,
      baselineRows: history("FR", usual),
      settings: { ...DEFAULT_FLASH_SETTINGS, enabledThreshold: false, minDatesPct: 8 },
    });
    expect(sales.map((s) => s.kind)).toEqual(["anomaly"]);
    expect(sales[0].direction).toBe("BCN-AGP");
  });

  it("periodo sin historial: solo funciona el precio chollo", () => {
    const points = scan("VY", usual, (i) => (i < 30 ? 15 : null)); // rebaja enorme, pero sin historial
    const { sales, warmup } = detectFlashSales({ points, baselineRows: [], settings: DEFAULT_FLASH_SETTINGS });
    expect(warmup.VY).toBe(true);
    expect(sales.map((s) => s.kind)).toEqual(["threshold"]);
    expect(sales[0].minPrice).toBe(15);
  });

  it("precio chollo: cualquier trayecto por debajo del precio fijo", () => {
    const points = scan("FR", usual, (i, d) => (i === 3 && d === "AGP-BCN" ? 19.99 : null));
    const { sales } = detectFlashSales({ points, baselineRows: history("FR", usual), settings: DEFAULT_FLASH_SETTINGS });
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ kind: "threshold", airline: "FR", direction: "AGP-BCN", minPrice: 19.99 });
  });

  it("sin historial de la misma fecha usa la mediana de fechas parecidas (mismo día de la semana)", () => {
    const rows: BaselineRow[] = [
      { direction: "BCN-AGP", airline: "VY", date: "2027-01-11", median: 80, n: 5 }, // lunes
      { direction: "BCN-AGP", airline: "VY", date: "2027-01-25", median: 100, n: 5 }, // lunes
      { direction: "BCN-AGP", airline: "VY", date: "2027-01-12", median: 10, n: 5 }, // martes: no cuenta
      { direction: "BCN-AGP", airline: "VY", date: "2027-01-18", median: 999, n: 1 }, // la propia fecha, poco historial
    ];
    const b = computeBaselines([{ direction: "BCN-AGP", airline: "VY", date: "2027-01-18", price: 50 }], rows);
    const v = b.get("BCN-AGP|VY|2027-01-18")!;
    expect(v.source).toBe("similar");
    expect(v.value).toBe(90);
  });
});

describe("anti-spam de ofertas (48 h)", () => {
  const points = scan("VY", usual, (i) => (i >= 10 && i < 25 ? Math.round(usual(i) * 0.6) : null));
  const sale = detectFlashSales({ points, baselineRows: history("VY", usual), settings: DEFAULT_FLASH_SETTINGS }).sales.find(
    (s) => s.kind === "anomaly",
  )!;
  const keys = sale.items.map((i) => `${i.direction}|${i.date}`);
  const now = new Date("2027-01-01T12:00:00Z");

  it("la primera vez avisa", () => expect(shouldNotifyFlash(sale, [], { now })).toBe(true));

  it("no repite la misma oferta dentro de 48 h", () => {
    const prev = [{ sentAt: "2027-01-01T00:00:00Z", airline: "VY" as const, kind: "anomaly" as const, dates: keys, minPrice: sale.minPrice }];
    expect(shouldNotifyFlash(sale, prev, { now })).toBe(false);
  });

  it("sí repite si el precio ha bajado más", () => {
    const prev = [{ sentAt: "2027-01-01T00:00:00Z", airline: "VY" as const, kind: "anomaly" as const, dates: keys, minPrice: sale.minPrice + 10 }];
    expect(shouldNotifyFlash(sale, prev, { now })).toBe(true);
  });

  it("pasadas 48 h vuelve a avisar", () => {
    const prev = [{ sentAt: "2026-12-29T00:00:00Z", airline: "VY" as const, kind: "anomaly" as const, dates: keys, minPrice: sale.minPrice }];
    expect(shouldNotifyFlash(sale, prev, { now })).toBe(true);
  });

  it("otra aerolínea o fechas distintas no cuentan como la misma oferta", () => {
    const prev = [
      { sentAt: "2027-01-01T00:00:00Z", airline: "FR" as const, kind: "anomaly" as const, dates: keys, minPrice: 1 },
      { sentAt: "2027-01-01T00:00:00Z", airline: "VY" as const, kind: "anomaly" as const, dates: ["BCN-AGP|2030-01-01"], minPrice: 1 },
    ];
    expect(shouldNotifyFlash(sale, prev, { now })).toBe(true);
  });
});

describe("viajes afectados", () => {
  it("detecta un seguimiento cuya ida o vuelta cae en una fecha rebajada", () => {
    const points = scan("VY", usual, (i) => (i >= 10 && i < 25 ? 30 : null));
    const sale = detectFlashSales({ points, baselineRows: history("VY", usual), settings: DEFAULT_FLASH_SETTINGS }).sales[0];
    const trackers = [
      { id: "a", origin: "BCN", destination: "AGP", outbound_date: addDays(START, 12), return_date: addDays(START, 30), flex_days: 0 },
      { id: "b", origin: "BCN", destination: "AGP", outbound_date: addDays(START, 1), return_date: addDays(START, 3), flex_days: 0 },
      { id: "c", origin: "AGP", destination: "BCN", outbound_date: addDays(START, 7), return_date: null, flex_days: 3 },
    ];
    expect(affectedTrackers(sale, trackers).map((t) => t.id)).toEqual(["a", "c"]);
  });
});
