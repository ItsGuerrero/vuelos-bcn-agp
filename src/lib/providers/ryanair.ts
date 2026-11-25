import type { Airport, Airline, DayPrice, Flight, PriceProvider, TimeWindow } from "../types";
import { monthsInRange } from "../core/dates";
import { fetchJson, type FetchJsonOptions } from "./http";

/**
 * Ryanair a través de los endpoints públicos que usa ryanair.com.
 * NO son oficiales: se usan con poca frecuencia, con caché (en la capa superior)
 * y con reintentos. Si fallan, quien llama registra el error y sigue.
 *
 * Endpoints:
 *  - Calendario de tarifas (1 llamada = precio más barato de cada día del mes):
 *    /api/farfnd/v4/oneWayFares/{from}/{to}/cheapestPerDay?outboundMonthOfDate=YYYY-MM-01&currency=EUR
 *  - Disponibilidad (todos los vuelos de un día con hora y número):
 *    /api/booking/v4/es-es/availability?...
 *  - Plan B si la disponibilidad se bloquea (solo el vuelo más barato del día):
 *    services-api.ryanair.com/farfnd/3/oneWayFares
 */

const BASE = "https://www.ryanair.com";
const SERVICES = "https://services-api.ryanair.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9",
};

// ---- Formas de las respuestas (solo lo que usamos) ----
interface CheapestPerDayResponse {
  outbound?: {
    fares?: Array<{
      day: string;
      departureDate?: string | null;
      arrivalDate?: string | null;
      price?: { value: number; currencyCode: string } | null;
      soldOut?: boolean;
      unavailable?: boolean;
    }>;
  };
}

interface AvailabilityResponse {
  currency?: string;
  trips?: Array<{
    origin: string;
    destination: string;
    dates?: Array<{
      dateOut: string;
      flights?: Array<{
        flightNumber: string;
        time?: [string, string];
        segments?: Array<{ flightNumber: string; time: [string, string] }>;
        regularFare?: { fares?: Array<{ type: string; amount: number }> } | null;
        faresLeft?: number;
      }>;
    }>;
  }>;
}

interface OneWayFares3Response {
  fares?: Array<{
    outbound: {
      departureDate: string;
      arrivalDate: string;
      flightNumber: string;
      price: { value: number; currencyCode: string };
    };
  }>;
}

const hhmm = (iso?: string | null) => (iso && iso.length >= 16 ? iso.slice(11, 16) : null);
const normFlightNumber = (s: string) => s.replace(/\s+/g, "");

// ---- Parsers (exportados para los tests) ----
export function parseCheapestPerDay(json: CheapestPerDayResponse, from: string, to: string): DayPrice[] {
  return (json.outbound?.fares ?? [])
    .filter((f) => f.day >= from && f.day <= to)
    .map((f) => ({
      date: f.day,
      airline: "FR" as Airline,
      price: f.unavailable || f.soldOut || !f.price ? null : f.price.value,
      provider: "ryanair",
    }));
}

export function parseAvailability(json: AvailabilityResponse, date: string): Flight[] {
  const out: Flight[] = [];
  for (const trip of json.trips ?? []) {
    for (const d of trip.dates ?? []) {
      if (!d.dateOut.startsWith(date)) continue;
      for (const f of d.flights ?? []) {
        // Solo vuelos directos (un segmento).
        if (f.segments && f.segments.length > 1) continue;
        const adt = f.regularFare?.fares?.find((x) => x.type === "ADT");
        if (!adt || f.faresLeft === 0) continue;
        out.push({
          airline: "FR",
          flightNumber: normFlightNumber(f.flightNumber),
          date,
          depTime: hhmm(f.time?.[0]),
          arrTime: hhmm(f.time?.[1]),
          price: adt.amount,
          currency: "EUR",
          provider: "ryanair",
        });
      }
    }
  }
  return out.sort((a, b) => a.price - b.price);
}

export function parseOneWayFares3(json: OneWayFares3Response, date: string): Flight[] {
  return (json.fares ?? [])
    .filter((f) => f.outbound.departureDate.startsWith(date))
    .map((f) => ({
      airline: "FR" as Airline,
      flightNumber: normFlightNumber(f.outbound.flightNumber),
      date,
      depTime: hhmm(f.outbound.departureDate),
      arrTime: hhmm(f.outbound.arrivalDate),
      price: f.outbound.price.value,
      currency: "EUR" as const,
      provider: "ryanair-farfnd3",
    }));
}

export class RyanairProvider implements PriceProvider {
  readonly name = "ryanair";
  readonly airlines: Airline[] = ["FR"];

  constructor(private http: FetchJsonOptions = {}) {}

  private get<T>(url: string) {
    return fetchJson<T>(url, { retries: 2, ...this.http, headers: { ...HEADERS, ...this.http.headers } });
  }

  async getCalendar(origin: Airport, dest: Airport, from: string, to: string, airline: Airline): Promise<DayPrice[]> {
    if (airline !== "FR") return [];
    const all: DayPrice[] = [];
    for (const month of monthsInRange(from, to)) {
      const url = `${BASE}/api/farfnd/v4/oneWayFares/${origin}/${dest}/cheapestPerDay?outboundMonthOfDate=${month}&currency=EUR`;
      const json = await this.get<CheapestPerDayResponse>(url);
      all.push(...parseCheapestPerDay(json, from, to));
    }
    return all;
  }

  /**
   * Precios por pasajero: se pide siempre 1 adulto y se multiplica después.
   * `window` (franja horaria) solo se usa en el plan B, que devuelve el vuelo más
   * barato DENTRO de esa franja; la disponibilidad ya trae todos los vuelos del día.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async searchOneWay(origin: Airport, dest: Airport, date: string, _passengers = 1, opts: { window?: TimeWindow } = {}): Promise<Flight[]> {
    const params = new URLSearchParams({
      ADT: "1", CHD: "0", TEEN: "0", INF: "0", Disc: "0",
      DateOut: date, DateIn: "", Origin: origin, Destination: dest,
      FlexDaysBeforeOut: "0", FlexDaysOut: "0", FlexDaysBeforeIn: "0", FlexDaysIn: "0",
      IncludeConnectingFlights: "false", RoundTrip: "false", ToUs: "AGREED", promoCode: "",
    });
    try {
      const json = await this.get<AvailabilityResponse>(`${BASE}/api/booking/v4/es-es/availability?${params}`);
      return parseAvailability(json, date);
    } catch (e) {
      // Plan B: el endpoint de tarifas devuelve al menos el vuelo más barato del día.
      const q = new URLSearchParams({
        departureAirportIataCode: origin,
        arrivalAirportIataCode: dest,
        outboundDepartureDateFrom: date,
        outboundDepartureDateTo: date,
        currency: "EUR",
        market: "es-es",
        language: "es",
        limit: "16",
        offset: "0",
      });
      if (opts.window?.after) q.set("outboundDepartureTimeFrom", opts.window.after);
      if (opts.window?.before) q.set("outboundDepartureTimeTo", opts.window.before);
      try {
        const json = await this.get<OneWayFares3Response>(`${SERVICES}/farfnd/3/oneWayFares?${q}`);
        return parseOneWayFares3(json, date);
      } catch {
        throw e;
      }
    }
  }
}
