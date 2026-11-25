import { describe, expect, it } from "vitest";
import { predict, predictionLine, trend, type PredictionInput } from "../src/lib/core/predict";
import { easterSunday, highSeason } from "../src/lib/core/holidays";

const base: PredictionInput = {
  today: "2026-11-25",
  outboundDate: "2027-03-10",
  tripDates: ["2027-03-10", "2027-03-14"],
  currentPerPerson: 100,
  typicalPerPerson: 100,
  typicalSource: "scans",
  googleLevel: null,
  history: [],
  activeFlashSale: null,
};

describe("festivos y temporada alta", () => {
  it("calcula la Pascua", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });
  it("detecta Reyes, Semana Santa y puentes", () => {
    expect(highSeason(["2027-01-01", "2027-01-07"])).toBe("Navidad y Reyes");
    expect(highSeason(["2027-03-25"])).toBe("Semana Santa");
    expect(highSeason(["2026-12-06"])).toBe("el puente de la Constitución");
    expect(highSeason(["2027-03-10"])).toBeNull();
  });
});

describe("heurística de predicción", () => {
  it("ejemplo del brief: faltan 5 semanas, Reyes y precio por debajo de lo normal → baja, comprar", () => {
    const p = predict({
      ...base,
      outboundDate: "2027-01-01",
      tripDates: ["2027-01-01", "2027-01-07"],
      currentPerPerson: 96,
      typicalPerPerson: 117,
    });
    expect(p.level).toBe("Baja");
    expect(p.recommendation).toBe("Comprar ya");
    expect(p.probability).toBeLessThan(30);
    expect(p.reasons.join(" ")).toMatch(/Navidad y Reyes/);
    expect(p.reasons.join(" ")).toMatch(/18 % por debajo de lo normal/);
  });

  it("vuelo lejano y precio caro → alta, esperar", () => {
    const p = predict({ ...base, outboundDate: "2027-04-20", tripDates: ["2027-04-20"], currentPerPerson: 140, typicalPerPerson: 100 });
    expect(p.level).toBe("Alta");
    expect(p.recommendation).toBe("Esperar");
    expect(p.summary).toMatch(/por encima de lo normal/);
  });

  it("menos de 2 semanas → casi seguro que no baja", () => {
    const p = predict({ ...base, outboundDate: "2026-12-03", tripDates: ["2026-12-03"] });
    expect(p.probability).toBeLessThanOrEqual(25);
    expect(p.reasons[0]).toMatch(/faltan 8 días/i);
  });

  it("una oferta flash activa baja la probabilidad (luego suele subir)", () => {
    const sin = predict(base).probability;
    const con = predict({ ...base, activeFlashSale: "Vueling" }).probability;
    expect(con).toBe(sin - 15);
  });

  it("la tendencia del histórico cuenta", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    const mk = (vals: number[]) => vals.map((total, k) => ({ t: now - (vals.length - 1 - k) * 86_400_000, total }));
    const subiendo = predict({ ...base, history: mk([90, 95, 100, 105, 110]) }, now);
    const bajando = predict({ ...base, history: mk([110, 105, 100, 95, 90]) }, now);
    expect(subiendo.probability).toBeLessThan(bajando.probability);
    expect(bajando.reasons.join(" ")).toMatch(/viene bajando/);
  });

  it("sin datos de referencia ni histórico lo avisa como orientativo", () => {
    const p = predict({ ...base, typicalPerPerson: null, typicalSource: null });
    expect(p.lowConfidence).toBe(true);
    expect(p.reasons.at(-1)).toMatch(/pocos datos/);
  });

  it("siempre da motivos y una probabilidad entre 5 y 90", () => {
    const p = predict({ ...base, outboundDate: "2026-11-26", tripDates: ["2026-12-24"], currentPerPerson: 50, typicalPerPerson: 100, googleLevel: "low", activeFlashSale: "Ryanair" });
    expect(p.probability).toBe(5);
    expect(p.reasons.length).toBeGreaterThan(0);
  });

  it("línea para Telegram", () => {
    const p = predict({ ...base, outboundDate: "2027-01-01", tripDates: ["2027-01-01", "2027-01-07"], currentPerPerson: 96, typicalPerPerson: 117 });
    expect(predictionLine(p)).toMatch(/^Probabilidad de que baje más: baja \(~\d+ %\), porque .+\. Recomendación: comprar\.$/);
  });

  it("trend: necesita al menos 3 puntos en 7 días", () => {
    expect(trend([{ t: 0, total: 1 }], 0)).toBeNull();
  });
});
