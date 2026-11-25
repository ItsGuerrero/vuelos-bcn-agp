export type Airport = "BCN" | "AGP";
export type Airline = "VY" | "FR";
export type Direction = "BCN-AGP" | "AGP-BCN";
export type Leg = "outbound" | "return";
export type ApiPurpose = "trackers" | "flash" | "manual";

export const AIRLINE_NAMES: Record<Airline, string> = {
  VY: "Vueling",
  FR: "Ryanair",
};

/** Un vuelo directo concreto. `price` es SIEMPRE por pasajero, en EUR. */
export interface Flight {
  airline: Airline;
  /** null cuando solo conocemos el precio mínimo del día (calendario). */
  flightNumber: string | null;
  /** Fecha de salida, YYYY-MM-DD (hora local). */
  date: string;
  /** Hora local de salida "HH:MM" (null si es un precio de calendario). */
  depTime: string | null;
  arrTime: string | null;
  price: number;
  currency: "EUR";
  provider: string;
  /** true si viene de un calendario (precio mínimo del día, sin detalle). */
  fromCalendar?: boolean;
}

/** Precio más barato de un día para una aerolínea (null = sin vuelos / agotado). */
export interface DayPrice {
  date: string;
  airline: Airline;
  price: number | null;
  provider: string;
}

/** Bloque price_insights de Google Flights. */
export interface PriceInsights {
  lowestPrice: number | null;
  priceLevel: string | null; // "low" | "typical" | "high"
  typicalPriceRange: [number, number] | null;
  priceHistory: Array<[number, number]>; // [timestamp(s), precio]
}

export interface PriceProvider {
  readonly name: string;
  /** Aerolíneas que este proveedor puede devolver. */
  readonly airlines: Airline[];
  searchOneWay(origin: Airport, dest: Airport, date: string, passengers: number, opts?: { window?: TimeWindow }): Promise<Flight[]>;
  getCalendar(origin: Airport, dest: Airport, from: string, to: string, airline: Airline): Promise<DayPrice[]>;
}

export interface TimeWindow {
  after?: string; // "HH:MM" inclusive
  before?: string; // "HH:MM" inclusive
}

export interface TimeFilters {
  outbound?: TimeWindow;
  return?: TimeWindow;
}

export type BaggageByAirline = Record<Airline, { label: string; price: number }>;
