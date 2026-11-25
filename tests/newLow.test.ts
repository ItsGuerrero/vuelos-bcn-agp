import { describe, expect, it } from "vitest";
import { evaluateNewLow } from "../src/lib/core/newLow";

const base = { minDropEur: 5, minDropPct: 3 };

describe("evaluateNewLow", () => {
  it("la primera comprobación fija la referencia y no avisa", () => {
    const r = evaluateNewLow({ ...base, price: 110, lowest: null, notifiedLow: null, firstPrice: null });
    expect(r.isFirstCheck).toBe(true);
    expect(r.notify).toBe(false);
    expect(r.lowest).toBe(110);
  });

  it("avisa si es mínimo histórico y baja lo suficiente", () => {
    const r = evaluateNewLow({ ...base, price: 96, lowest: 110, notifiedLow: null, firstPrice: 110 });
    expect(r.notify).toBe(true);
    expect(r.drop).toBe(14);
    expect(r.notifiedLow).toBe(96);
  });

  it("no avisa por bajadas pequeñas (1 €)", () => {
    const r = evaluateNewLow({ ...base, price: 199, lowest: 200, notifiedLow: 200, firstPrice: 220 });
    expect(r.isHistoricLow).toBe(true);
    expect(r.notify).toBe(false);
    expect(r.lowest).toBe(199);
  });

  it("acumula bajadas pequeñas hasta superar el umbral", () => {
    let state = { lowest: 100 as number | null, notifiedLow: 100 as number | null };
    const prices = [99, 98, 97, 96, 95];
    const notified: number[] = [];
    for (const p of prices) {
      const r = evaluateNewLow({ minDropEur: 5, minDropPct: 50, price: p, ...state, firstPrice: 120 });
      if (r.notify) notified.push(p);
      state = { lowest: r.lowest, notifiedLow: r.notifiedLow };
    }
    expect(notified).toEqual([95]);
  });

  it("el umbral en % también cuenta", () => {
    const r = evaluateNewLow({ minDropEur: 50, minDropPct: 3, price: 38.5, lowest: 40, notifiedLow: 40, firstPrice: 40 });
    expect(r.dropPct).toBeCloseTo(3.75);
    expect(r.notify).toBe(true);
  });

  it("no avisa si el precio sube", () => {
    const r = evaluateNewLow({ ...base, price: 130, lowest: 96, notifiedLow: 96, firstPrice: 110 });
    expect(r.notify).toBe(false);
    expect(r.lowest).toBe(96);
  });
});
