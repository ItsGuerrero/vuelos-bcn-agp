import { describe, expect, it } from "vitest";
import { bestCombinations, buildDateMatrix, type ComboOptions } from "../src/lib/core/combos";
import type { Flight } from "../src/lib/types";

const f = (p: Partial<Flight> & Pick<Flight, "airline" | "date" | "price">): Flight => ({
  flightNumber: `${p.airline}${Math.round(p.price)}`,
  depTime: "10:00",
  arrTime: "11:30",
  currency: "EUR",
  provider: "test",
  ...p,
});

const opts = (o: Partial<ComboOptions> = {}): ComboOptions => ({
  passengers: 1,
  baggage: { VY: 0, FR: 0 },
  withBaggage: false,
  ...o,
});

describe("bestCombinations", () => {
  const out = [
    f({ airline: "VY", date: "2027-01-01", price: 40, depTime: "08:40" }),
    f({ airline: "FR", date: "2027-01-01", price: 55, depTime: "15:00" }),
  ];
  const ret = [
    f({ airline: "VY", date: "2027-01-07", price: 70, depTime: "20:00" }),
    f({ airline: "FR", date: "2027-01-07", price: 56, depTime: "19:15" }),
  ];

  it("mezcla aerolíneas: ida Vueling + vuelta Ryanair", () => {
    const [best, ...alts] = bestCombinations(out, ret, opts());
    expect(best.outbound.airline).toBe("VY");
    expect(best.return?.airline).toBe("FR");
    expect(best.total).toBe(96);
    expect(alts.map((a) => a.total)).toEqual([110, 111, 125]);
  });

  it("devuelve la mejor y 3 alternativas", () => {
    expect(bestCombinations(out, ret, opts())).toHaveLength(4);
  });

  it("suma el equipaje por trayecto y pasajero y puede cambiar la mejor opción", () => {
    // Maleta Ryanair carísima: la mejor pasa a ser Vueling + Vueling.
    const combos = bestCombinations(out, ret, opts({ withBaggage: true, baggage: { VY: 0, FR: 30 } }));
    expect(combos[0].outbound.airline).toBe("VY");
    expect(combos[0].return?.airline).toBe("VY");
    expect(combos[0].totalWithBags).toBe(110);
    // El precio base se sigue mostrando aparte.
    const mixed = combos.find((c) => c.return?.airline === "FR")!;
    expect(mixed.baseTotal).toBe(96);
    expect(mixed.totalWithBags).toBe(126);
  });

  it("multiplica por el número de pasajeros (tarifa + equipaje)", () => {
    const [best] = bestCombinations(out, ret, opts({ passengers: 2, withBaggage: true, baggage: { VY: 10, FR: 10 } }));
    expect(best.baseTotal).toBe(192);
    expect(best.totalWithBags).toBe(232);
  });

  it("solo ida", () => {
    const [best] = bestCombinations(out, null, opts());
    expect(best.return).toBeNull();
    expect(best.total).toBe(40);
  });

  it("aplica los filtros de horario", () => {
    const [best] = bestCombinations(out, ret, opts({ timeFilters: { outbound: { after: "09:00" }, return: { after: "19:30" } } }));
    expect(best.outbound.airline).toBe("FR");
    expect(best.return?.airline).toBe("VY");
    expect(best.total).toBe(125);
  });

  it("un precio de calendario (sin hora) no pasa un filtro horario", () => {
    const cal = f({ airline: "VY", date: "2027-01-01", price: 10, depTime: null, flightNumber: null, fromCalendar: true });
    const [best] = bestCombinations([cal, ...out], null, opts({ timeFilters: { outbound: { after: "09:00" } } }));
    expect(best.outbound.airline).toBe("FR");
  });

  it("el detalle sustituye al precio de calendario de la misma aerolínea y día", () => {
    const cal = f({ airline: "VY", date: "2027-01-01", price: 35, depTime: null, flightNumber: null, fromCalendar: true });
    const combos = bestCombinations([cal, ...out], null, opts());
    expect(combos.some((c) => c.outbound.fromCalendar)).toBe(false);
  });

  it("descarta vueltas anteriores a la ida", () => {
    const early = f({ airline: "FR", date: "2026-12-31", price: 5 });
    const combos = bestCombinations(out, [early], opts());
    expect(combos).toHaveLength(0);
  });
});

describe("buildDateMatrix", () => {
  it("encuentra la combinación de fechas más barata", () => {
    const m = buildDateMatrix(
      {
        "2027-01-01": [f({ airline: "VY", date: "2027-01-01", price: 40 })],
        "2027-01-02": [f({ airline: "FR", date: "2027-01-02", price: 25 })],
      },
      {
        "2027-01-07": [f({ airline: "FR", date: "2027-01-07", price: 50 })],
        "2027-01-08": [f({ airline: "VY", date: "2027-01-08", price: 30 })],
      },
      opts(),
    );
    expect(m.cells).toEqual([
      [90, 70],
      [75, 55],
    ]);
    expect(m.best).toEqual({ outboundDate: "2027-01-02", returnDate: "2027-01-08", total: 55 });
  });
});
