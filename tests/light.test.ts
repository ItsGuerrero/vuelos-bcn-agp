import { describe, expect, it } from "vitest";
import { trackerLight } from "../src/lib/core/light";

describe("semáforo provisional", () => {
  const base = { status: "active" as const, target: null };
  it("verde en el mínimo", () => expect(trackerLight({ ...base, current: 96, lowest: 96 }).light).toBe("green"));
  it("ámbar si está a ≤5 % del mínimo", () =>
    expect(trackerLight({ ...base, current: 100, lowest: 96 })).toEqual({ light: "amber", label: "Cerca del mínimo (+4 %)" }));
  it("rojo si está bastante por encima", () => expect(trackerLight({ ...base, current: 120, lowest: 96 }).light).toBe("red"));
  it("verde si baja del objetivo aunque no sea mínimo", () =>
    expect(trackerLight({ ...base, current: 120, lowest: 96, target: 125 }).light).toBe("green"));
  it("con predicción usa su recomendación", () => {
    expect(trackerLight({ ...base, current: 120, lowest: 96, prediction: { recommendation: "Comprar ya", probability: 18 } })).toEqual({
      light: "green",
      label: "Comprar ya · baja ~18 %",
    });
    expect(trackerLight({ ...base, current: 96, lowest: 96, prediction: { recommendation: "Esperar", probability: 70 } }).light).toBe("red");
  });
  it("gris si está comprado o sin datos", () => {
    expect(trackerLight({ ...base, status: "purchased", current: 1, lowest: 1 }).light).toBe("grey");
    expect(trackerLight({ ...base, current: null, lowest: null }).light).toBe("grey");
  });
});
