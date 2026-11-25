import { describe, expect, it } from "vitest";
import { buildPredictionInput, freshInsight, scansTypical, type PrevCheck } from "../src/lib/core/predictionInputs";
import { riseRiskMessage } from "../src/lib/notify/messages";
import type { Combo } from "../src/lib/core/combos";
import type { BaselineRow } from "../src/lib/core/flash";

const now = Date.parse("2026-11-25T20:00:00Z");
const ins = (date: string, range: [number, number], level = "typical") => ({
  date,
  lowestPrice: range[0],
  priceLevel: level,
  typicalPriceRange: range,
  priceHistory: [] as Array<[number, number]>,
});

const best: Combo = {
  outbound: { airline: "VY", flightNumber: "VY1540", date: "2027-01-01", depTime: "08:55", arrTime: "10:35", price: 33, currency: "EUR", provider: "t" },
  return: { airline: "VY", flightNumber: "VY1561", date: "2027-01-07", depTime: "23:20", arrTime: "00:55", price: 76, currency: "EUR", provider: "t" },
  baseTotal: 109,
  totalWithBags: 109,
  total: 109,
};
const tracker = { origin: "BCN" as const, destination: "AGP" as const, outbound_date: "2027-01-01", return_date: "2027-01-07", passengers: 1 };

describe("insights reutilizables", () => {
  const prev: PrevCheck[] = [{ checked_at: "2026-11-25T08:00:00Z", best_total: 115, insights: { outbound: ins("2027-01-01", [30, 90]) } }];
  it("usa uno previo si es de la misma fecha y reciente", () => {
    expect(freshInsight({}, prev, "outbound", "2027-01-01", 24, now)?.typicalPriceRange).toEqual([30, 90]);
  });
  it("no si es de otra fecha o demasiado viejo", () => {
    expect(freshInsight({}, prev, "outbound", "2027-01-02", 24, now)).toBeNull();
    expect(freshInsight({}, prev, "outbound", "2027-01-01", 6, now)).toBeNull();
  });
});

describe("entradas de la predicción", () => {
  it("con Google en los dos trayectos usa el centro del rango típico", () => {
    const i = buildPredictionInput({
      today: "2026-11-25",
      tracker,
      best,
      insights: { outbound: ins("2027-01-01", [30, 90], "low"), return: ins("2027-01-07", [50, 110], "low") },
      previous: [],
      baselineRows: [],
      activeFlashSale: null,
      nowMs: now,
    });
    expect(i.typicalPerPerson).toBe(140);
    expect(i.typicalSource).toBe("google");
    expect(i.googleLevel).toBe("low");
    expect(i.currentPerPerson).toBe(109);
    expect(i.tripDates).toEqual(["2027-01-01", "2027-01-07"]);
  });

  it("si falta Google en un trayecto, usa nuestros escaneos para ese trayecto", () => {
    const rows: BaselineRow[] = [
      { direction: "AGP-BCN", airline: "VY", date: "2027-01-07", median: 80, n: 5 },
      { direction: "AGP-BCN", airline: "FR", date: "2027-01-07", median: 70, n: 5 },
    ];
    expect(scansTypical("AGP-BCN", "2027-01-07", rows)).toBe(70);
    const i = buildPredictionInput({
      today: "2026-11-25",
      tracker,
      best,
      insights: { outbound: ins("2027-01-01", [30, 90]) },
      previous: [],
      baselineRows: rows,
      activeFlashSale: null,
      nowMs: now,
    });
    expect(i.typicalPerPerson).toBe(130);
    expect(i.typicalSource).toBe("scans");
  });

  it("sin ninguna referencia, typical es null", () => {
    const i = buildPredictionInput({ today: "2026-11-25", tracker, best, insights: {}, previous: [], baselineRows: [], activeFlashSale: null, nowMs: now });
    expect(i.typicalPerPerson).toBeNull();
  });
});

describe("aviso de riesgo de subida", () => {
  it("incluye precio, motivos y recomendación", () => {
    const m = riseRiskMessage({
      tracker: { id: "x", ...tracker, target_price: null },
      combo: best,
      total: 109,
      lowest: 105,
      appUrl: "https://app",
      prediction: { probability: 15, reasons: ["Faltan 5 semanas", "Es temporada de Navidad y Reyes"] },
    });
    expect(m.text).toContain("⚠️ <b>Riesgo de subida BCN⇄AGP (1–7 ene): 109 €</b>");
    expect(m.text).toContain("cerca del mínimo (105 €)");
    expect(m.text).toContain("• Faltan 5 semanas");
    expect(m.text).toContain("comprar ya");
  });
});
