import { diffDays } from "./dates";
import { highSeason } from "./holidays";

/**
 * Predicción "¿bajará?" — fase 1: HEURÍSTICA TRANSPARENTE.
 *
 * Nadie puede predecir los precios con certeza. Esto no es un modelo entrenado: combina
 * señales razonables con pesos fijos y SIEMPRE devuelve los motivos, para que se vea por
 * qué dice lo que dice. Cuando haya bastante historial se podrá sustituir por un modelo
 * estadístico (fase 2 de la predicción) con su tasa de acierto real.
 */

export interface PredictionInput {
  today: string;
  outboundDate: string;
  /** Fechas del viaje (ida y vuelta) para detectar temporada alta. */
  tripDates: string[];
  /** Precio actual comparable (por persona y sin equipaje), suma de los trayectos. */
  currentPerPerson: number;
  /** Precio habitual para esas mismas fechas (por persona), si se conoce. */
  typicalPerPerson: number | null;
  typicalSource: "google" | "scans" | null;
  /** price_level de Google ("low" | "typical" | "high"), si lo hay. */
  googleLevel: string | null;
  /** Histórico propio: totales comparables ordenados por fecha. */
  history: Array<{ t: number; total: number }>;
  /** Nombre de la aerolínea con una oferta flash activa en estas fechas, si la hay. */
  activeFlashSale: string | null;
}

export type Recommendation = "Comprar ya" | "Vigilar de cerca" | "Esperar";

export interface Prediction {
  probability: number; // 0–100, probabilidad orientativa de que baje
  level: "Baja" | "Media" | "Alta";
  recommendation: Recommendation;
  reasons: string[];
  /** Frase corta con los motivos principales, para los avisos. */
  summary: string;
  lowConfidence: boolean;
}

const pctText = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;

function daysText(d: number): string {
  if (d >= 14 && d % 7 <= 1) return `faltan ${Math.round(d / 7)} semanas`;
  return d === 1 ? "falta 1 día" : `faltan ${d} días`;
}

/** Pendiente relativa diaria (regresión lineal simple sobre los últimos 7 días). */
export function trend(history: Array<{ t: number; total: number }>, nowMs: number): { slopePctPerDay: number; cv: number } | null {
  const recent = history.filter((h) => nowMs - h.t <= 7 * 86_400_000);
  if (recent.length < 3) return null;
  const xs = recent.map((h) => (h.t - recent[0].t) / 86_400_000);
  const ys = recent.map((h) => h.total);
  const n = recent.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = sxx === 0 ? 0 : xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
  const sd = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0) / n);
  return { slopePctPerDay: my ? slope / my : 0, cv: my ? sd / my : 0 };
}

export function predict(i: PredictionInput, nowMs = Date.now()): Prediction {
  const reasons: Array<{ text: string; weight: number }> = [];
  let p = 45;
  const add = (delta: number, text: string) => {
    p += delta;
    reasons.push({ text, weight: Math.abs(delta) });
  };

  // 1. Días que faltan: en rutas nacionales low-cost el precio suele subir en las últimas 2–3 semanas.
  const d = diffDays(i.today, i.outboundDate);
  if (d < 14) add(-25, `${daysText(d)} y en las últimas 2 semanas el precio casi nunca baja`);
  else if (d < 21) add(-15, `${daysText(d)}: a menos de 3 semanas suele subir`);
  else if (d <= 45) add(0, daysText(d));
  else if (d <= 90) add(+5, `${daysText(d)}: aún hay margen`);
  else add(+10, `${daysText(d)}: queda mucho y los precios aún se moverán`);

  // 2. Precio frente a lo habitual.
  if (i.typicalPerPerson && i.typicalPerPerson > 0) {
    const diff = (i.currentPerPerson - i.typicalPerPerson) / i.typicalPerPerson;
    const fuente = i.typicalSource === "google" ? "según Google" : "según nuestros escaneos";
    if (diff <= -0.15) add(-15, `el precio está un ${pctText(diff)} por debajo de lo normal (${fuente})`);
    else if (diff <= -0.05) add(-7, `el precio está un ${pctText(diff)} por debajo de lo normal (${fuente})`);
    else if (diff < 0.05) add(0, `el precio está en lo normal (${fuente})`);
    else if (diff < 0.2) add(+8, `el precio está un ${pctText(diff)} por encima de lo normal (${fuente})`);
    else add(+15, `el precio está un ${pctText(diff)} por encima de lo normal (${fuente}): hay margen para bajar`);
  }
  if (i.googleLevel === "low") add(-8, "Google lo considera un precio bajo");
  else if (i.googleLevel === "high") add(+8, "Google lo considera un precio alto");

  // 3. Temporada alta y festivos.
  const season = highSeason(i.tripDates);
  if (season) {
    const txt = /^(el|la) /.test(season)
      ? `el viaje cae en ${season}`
      : season === "verano"
        ? "es temporada alta de verano"
        : `es temporada de ${season}`;
    add(-12, `${txt} y los precios rara vez bajan`);
  }

  // 4. Tendencia y volatilidad de nuestro propio histórico.
  const tr = trend(i.history, nowMs);
  if (tr) {
    if (tr.slopePctPerDay > 0.01) add(-8, "el precio lleva varios días subiendo");
    else if (tr.slopePctPerDay < -0.01) add(+8, "el precio viene bajando estos días");
    if (tr.cv > 0.08) add(+5, "el precio se mueve mucho: puede haber bajadas puntuales");
  }

  // 5. Oferta flash activa: cuando termine, lo normal es que el precio vuelva a subir.
  if (i.activeFlashSale) add(-15, `${i.activeFlashSale} tiene una oferta activa y cuando termine lo normal es que suba`);

  const probability = Math.max(5, Math.min(90, Math.round(p)));
  const level = probability < 30 ? "Baja" : probability <= 55 ? "Media" : "Alta";
  const lowConfidence = !i.typicalPerPerson && i.history.length < 3;

  let recommendation: Recommendation = probability < 30 ? "Comprar ya" : probability <= 55 ? "Vigilar de cerca" : "Esperar";
  // Si está claramente caro y aún queda tiempo, no empujamos a comprar.
  if (recommendation === "Comprar ya" && i.typicalPerPerson && i.currentPerPerson > i.typicalPerPerson * 1.2 && d > 21) {
    recommendation = "Vigilar de cerca";
  }

  const ordered = reasons.filter((r) => r.text).sort((a, b) => b.weight - a.weight);
  const list = ordered.map((r) => r.text);
  if (lowConfidence) list.push("aún hay pocos datos: la estimación es muy orientativa");
  const top = ordered.slice(0, 2).map((r) => r.text);
  const summary = top.length ? capitalize(top.join("; ")) : "Sin señales claras";

  return { probability, level, recommendation, reasons: list.map(capitalize), summary, lowConfidence };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Línea para los avisos de Telegram. */
export function predictionLine(p: Prediction): string {
  const rec = { "Comprar ya": "comprar", "Vigilar de cerca": "vigilar de cerca", Esperar: "esperar" }[p.recommendation];
  return `Probabilidad de que baje más: ${p.level.toLowerCase()} (~${p.probability} %), porque ${p.summary.charAt(0).toLowerCase()}${p.summary.slice(1)}. Recomendación: ${rec}.`;
}
