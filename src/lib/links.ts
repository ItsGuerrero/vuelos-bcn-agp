import type { Airline, Airport } from "./types";

/**
 * Enlaces de compra. La app NUNCA compra: solo abre la web de la aerolínea.
 * Ryanair admite un enlace directo a la búsqueda; para Vueling abrimos su web
 * (no tiene un enlace de búsqueda público y estable).
 */
export function buyLink(opts: {
  airline: Airline;
  origin: Airport;
  dest: Airport;
  date: string;
  passengers: number;
}): string {
  if (opts.airline === "FR") {
    const q = new URLSearchParams({
      adults: String(opts.passengers),
      teens: "0",
      children: "0",
      infants: "0",
      dateOut: opts.date,
      dateIn: "",
      isConnectedFlight: "false",
      isReturn: "false",
      discount: "0",
      originIata: opts.origin,
      destinationIata: opts.dest,
    });
    return `https://www.ryanair.com/es/es/trip/flights/select?${q}`;
  }
  return "https://www.vueling.com/es";
}
