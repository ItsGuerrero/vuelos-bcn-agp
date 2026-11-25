/**
 * Semáforo del listado: la recomendación de la predicción ("Comprar ya" / "Vigilar de cerca" /
 * "Esperar"). Si aún no hay predicción, compara el precio actual con el mínimo y el objetivo.
 */
export type LightColor = "green" | "amber" | "red" | "grey";

export function trackerLight(t: {
  status: "active" | "paused" | "purchased" | "expired";
  current: number | null;
  lowest: number | null;
  target: number | null;
  prediction?: { recommendation: string; probability: number } | null;
}): { light: LightColor; label: string } {
  if (t.status === "purchased") return { light: "grey", label: "Comprado" };
  if (t.status === "expired") return { light: "grey", label: "Ya pasó" };
  if (t.status === "paused") return { light: "grey", label: "En pausa" };
  if (t.current === null) return { light: "grey", label: "Esperando primera comprobación" };
  if (t.target !== null && t.current <= t.target) return { light: "green", label: "Por debajo de tu objetivo" };
  if (t.prediction) {
    const p = t.prediction;
    const light: LightColor = p.recommendation === "Comprar ya" ? "green" : p.recommendation === "Esperar" ? "red" : "amber";
    return { light, label: `${p.recommendation} · baja ~${p.probability} %` };
  }
  if (t.lowest === null || t.current <= t.lowest) return { light: "green", label: "En su mínimo" };
  const pct = Math.round(((t.current - t.lowest) / t.lowest) * 100);
  if (pct <= 5) return { light: "amber", label: `Cerca del mínimo (+${pct} %)` };
  return { light: "red", label: `Por encima del mínimo (+${pct} %)` };
}
