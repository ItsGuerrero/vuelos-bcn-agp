import type { Airport, Airline, DayPrice, Flight, PriceInsights, PriceProvider } from "../types";
import { addDays, diffDays } from "../core/dates";
import { fetchJson, type FetchJsonOptions } from "./http";

/**
 * Google Flights a través de SerpApi.
 *  - engine=google_flights: detalle de un día (Vueling + contraste de Ryanair) y price_insights.
 *  - engine=google_flights_calendar: precio más barato de cada día de un rango, filtrado
 *    por una aerolínea (include_airlines) y solo vuelos directos (stops=1).
 *
 * Cada llamada cuenta para el límite mensual: `onCall` se invoca ANTES de cada petición
 * (aunque luego falle, SerpApi puede cobrarla) para que el contador sea conservador.
 */

const ENDPOINT = "https://serpapi.com/search.json";

// ---- Formas de las respuestas (solo lo que usamos) ----
interface GFFlightLeg {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  airline?: string;
  flight_number?: string;
}
interface GFOption {
  flights?: GFFlightLeg[];
  price?: number;
}
interface GoogleFlightsResponse {
  best_flights?: GFOption[];
  other_flights?: GFOption[];
  price_insights?: {
    lowest_price?: number;
    price_level?: string;
    typical_price_range?: [number, number];
    price_history?: Array<[number, number]>;
  };
  error?: string;
}
interface CalendarResponse {
  prices?: Array<{ outbound_date?: string; departure?: string; price?: number | null }>;
  error?: string;
}

const AIRLINE_PREFIX: Record<string, Airline> = { VY: "VY", FR: "FR" };

export function parseGoogleFlights(
  json: GoogleFlightsResponse,
  date: string,
  passengers: number,
): { flights: Flight[]; insights: PriceInsights | null } {
  if (json.error && !/no results/i.test(json.error)) throw new Error(`SerpApi: ${json.error}`);
  const flights: Flight[] = [];
  for (const opt of [...(json.best_flights ?? []), ...(json.other_flights ?? [])]) {
    const legs = opt.flights ?? [];
    if (legs.length !== 1 || typeof opt.price !== "number") continue; // solo directos
    const leg = legs[0];
    const fn = (leg.flight_number ?? "").replace(/\s+/g, "");
    const airline = AIRLINE_PREFIX[fn.slice(0, 2)];
    if (!airline) continue;
    flights.push({
      airline,
      flightNumber: fn,
      date,
      depTime: leg.departure_airport?.time?.slice(11, 16) ?? null,
      arrTime: leg.arrival_airport?.time?.slice(11, 16) ?? null,
      // Google da el precio total de todos los pasajeros → lo pasamos a por persona.
      price: Math.round((opt.price / passengers) * 100) / 100,
      currency: "EUR",
      provider: "serpapi",
    });
  }
  const pi = json.price_insights;
  const insights: PriceInsights | null = pi
    ? {
        lowestPrice: pi.lowest_price ?? null,
        priceLevel: pi.price_level ?? null,
        typicalPriceRange: pi.typical_price_range ?? null,
        priceHistory: pi.price_history ?? [],
      }
    : null;
  return { flights: flights.sort((a, b) => a.price - b.price), insights };
}

export function parseCalendar(json: CalendarResponse, airline: Airline, from: string, to: string): DayPrice[] {
  if (json.error && !/no results/i.test(json.error)) throw new Error(`SerpApi: ${json.error}`);
  return (json.prices ?? [])
    .map((p) => ({ date: (p.outbound_date ?? p.departure ?? "").slice(0, 10), price: p.price ?? null }))
    .filter((p) => p.date >= from && p.date <= to)
    .map((p) => ({ date: p.date, airline, price: typeof p.price === "number" ? p.price : null, provider: "serpapi-calendar" }));
}

export interface SerpApiOptions {
  apiKey: string;
  onCall?: (engine: string) => Promise<void> | void;
  /** Días máximos por llamada al calendario (por si Google limita el rango). */
  calendarMaxDays?: number;
  http?: FetchJsonOptions;
}

export class SerpApiProvider implements PriceProvider {
  readonly name = "serpapi";
  readonly airlines: Airline[] = ["VY", "FR"];

  constructor(private opts: SerpApiOptions) {}

  private async call<T>(params: Record<string, string>): Promise<T> {
    await this.opts.onCall?.(params.engine);
    const qs = new URLSearchParams({ ...params, api_key: this.opts.apiKey, currency: "EUR", hl: "es", gl: "es" });
    // Pocos reintentos: cada reintento puede gastar una búsqueda.
    return fetchJson<T>(`${ENDPOINT}?${qs}`, { retries: 1, timeoutMs: 45_000, ...this.opts.http });
  }

  /**
   * Detalle de un día. `filters` permite quitar el filtro de aerolíneas o de escalas
   * (Google puede no devolver price_insights con filtros): el parser se queda igualmente
   * solo con vuelos directos de VY y FR.
   */
  async searchOneWayDetailed(
    origin: Airport,
    dest: Airport,
    date: string,
    passengers = 1,
    filters: { airlines?: Airline[] | null; nonstop?: boolean } = {},
  ) {
    const airlines = filters.airlines === undefined ? (["VY", "FR"] as Airline[]) : filters.airlines;
    const nonstop = filters.nonstop ?? true;
    const json = await this.call<GoogleFlightsResponse & { search_metadata?: { id?: string } }>({
      engine: "google_flights",
      type: "2",
      departure_id: origin,
      arrival_id: dest,
      outbound_date: date,
      adults: String(passengers),
      ...(nonstop ? { stops: "1" } : {}),
      ...(airlines && airlines.length ? { include_airlines: airlines.join(",") } : {}),
    });
    return { ...parseGoogleFlights(json, date, passengers), searchId: json.search_metadata?.id ?? null };
  }

  async searchOneWay(origin: Airport, dest: Airport, date: string, passengers = 1): Promise<Flight[]> {
    return (await this.searchOneWayDetailed(origin, dest, date, passengers)).flights;
  }

  async getCalendar(origin: Airport, dest: Airport, from: string, to: string, airline: Airline): Promise<DayPrice[]> {
    const maxDays = this.opts.calendarMaxDays ?? 90;
    const out: DayPrice[] = [];
    for (let start = from; start <= to; start = addDays(start, maxDays)) {
      const end = diffDays(start, to) >= maxDays ? addDays(start, maxDays - 1) : to;
      const json = await this.call<CalendarResponse>({
        engine: "google_flights_calendar",
        type: "2",
        departure_id: origin,
        arrival_id: dest,
        date_range_start: start,
        date_range_end: end,
        stops: "1",
        include_airlines: airline,
        adults: "1",
      });
      out.push(...parseCalendar(json, airline, start, end));
    }
    return out;
  }
}
