import { describe, expect, it, vi } from "vitest";
import { parseAvailability, parseCheapestPerDay, RyanairProvider } from "../src/lib/providers/ryanair";
import { parseCalendar, parseGoogleFlights } from "../src/lib/providers/serpapi";
import { fetchJson } from "../src/lib/providers/http";

// Respuestas simuladas con la forma de las APIs reales (recortadas).

describe("Ryanair", () => {
  it("calendario: precio por día, null si agotado", () => {
    const days = parseCheapestPerDay(
      {
        outbound: {
          fares: [
            { day: "2026-12-01", price: { value: 19.99, currencyCode: "EUR" }, soldOut: false, unavailable: false },
            { day: "2026-12-02", price: null, soldOut: true, unavailable: false },
            { day: "2026-12-03", price: { value: 35, currencyCode: "EUR" }, unavailable: true },
          ],
        },
      },
      "2026-12-01",
      "2026-12-31",
    );
    expect(days.map((d) => d.price)).toEqual([19.99, null, null]);
    expect(days[0].airline).toBe("FR");
  });

  it("disponibilidad: vuelos directos con hora y tarifa de adulto", () => {
    const flights = parseAvailability(
      {
        trips: [
          {
            origin: "BCN",
            destination: "AGP",
            dates: [
              {
                dateOut: "2027-01-07T00:00:00.000",
                flights: [
                  {
                    flightNumber: "FR 5431",
                    time: ["2027-01-07T19:15:00.000", "2027-01-07T20:50:00.000"],
                    segments: [{ flightNumber: "FR 5431", time: ["", ""] }],
                    regularFare: { fares: [{ type: "ADT", amount: 56.0 }] },
                    faresLeft: -1,
                  },
                  { flightNumber: "FR 1", time: ["2027-01-07T06:00:00.000", "x"], regularFare: null },
                ],
              },
            ],
          },
        ],
      },
      "2027-01-07",
    );
    expect(flights).toEqual([
      expect.objectContaining({ airline: "FR", flightNumber: "FR5431", depTime: "19:15", arrTime: "20:50", price: 56 }),
    ]);
  });

  it("si la disponibilidad falla, usa el plan B", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("availability")) return new Response("blocked", { status: 409 });
      return Response.json({
        fares: [
          {
            outbound: {
              departureDate: "2027-01-07T19:15:00",
              arrivalDate: "2027-01-07T20:50:00",
              flightNumber: "FR5431",
              price: { value: 49.99, currencyCode: "EUR" },
            },
          },
        ],
      });
    });
    const p = new RyanairProvider({ fetchImpl: fetchImpl as typeof fetch, sleep: async () => {} });
    const flights = await p.searchOneWay("BCN", "AGP", "2027-01-07");
    expect(flights[0]).toMatchObject({ price: 49.99, depTime: "19:15", provider: "ryanair-farfnd3" });
  });
});

describe("SerpApi", () => {
  it("google_flights: solo directos, código de aerolínea y precio por persona", () => {
    const r = parseGoogleFlights(
      {
        best_flights: [
          {
            flights: [
              {
                departure_airport: { id: "BCN", time: "2027-01-01 08:40" },
                arrival_airport: { id: "AGP", time: "2027-01-01 10:15" },
                airline: "Vueling",
                flight_number: "VY 2116",
              },
            ],
            price: 84,
          },
        ],
        other_flights: [
          { flights: [{ flight_number: "VY 1" }, { flight_number: "VY 2" }], price: 20 }, // con escala
          { flights: [{ flight_number: "IB 1", departure_airport: { time: "2027-01-01 12:00" } }], price: 10 }, // otra aerolínea
        ],
        price_insights: { lowest_price: 84, price_level: "low", typical_price_range: [90, 140], price_history: [[1, 100]] },
      },
      "2027-01-01",
      2,
    );
    expect(r.flights).toEqual([
      expect.objectContaining({ airline: "VY", flightNumber: "VY2116", depTime: "08:40", arrTime: "10:15", price: 42 }),
    ]);
    expect(r.insights).toEqual({ lowestPrice: 84, priceLevel: "low", typicalPriceRange: [90, 140], priceHistory: [[1, 100]] });
  });

  it("calendario: precio por día de la aerolínea filtrada", () => {
    const days = parseCalendar(
      { prices: [{ outbound_date: "2027-02-04", price: 19 }, { outbound_date: "2027-02-05", price: null }] },
      "VY",
      "2027-02-01",
      "2027-02-28",
    );
    expect(days).toEqual([
      { date: "2027-02-04", airline: "VY", price: 19, provider: "serpapi-calendar" },
      { date: "2027-02-05", airline: "VY", price: null, provider: "serpapi-calendar" },
    ]);
  });

  it("propaga errores de SerpApi (p. ej. clave inválida)", () => {
    expect(() => parseCalendar({ error: "Invalid API key." }, "VY", "a", "z")).toThrow(/Invalid API key/);
  });
});

describe("fetchJson", () => {
  it("reintenta con espera exponencial en 5xx y luego funciona", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n < 3 ? new Response("err", { status: 503 }) : Response.json({ ok: 1 })));
    const sleeps: number[] = [];
    const r = await fetchJson("https://x", { fetchImpl: fetchImpl as typeof fetch, sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 100 });
    expect(r).toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  it("no reintenta errores 4xx (salvo 408/429)", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(fetchJson("https://x?api_key=SECRET", { fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("no filtra la clave de la API en los errores", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(fetchJson("https://x?api_key=SECRET", { fetchImpl: fetchImpl as typeof fetch })).rejects.not.toThrow(/SECRET/);
  });
});
