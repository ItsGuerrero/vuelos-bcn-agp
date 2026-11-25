/**
 * Aviso de "precio objetivo".
 * - Avisa la primera vez que el precio baja de (o iguala) el objetivo.
 * - Mientras siga por debajo, solo vuelve a avisar si baja al menos `minDropEur`
 *   respecto al último aviso.
 * - Si el precio vuelve a subir por encima del objetivo, se rearma: la próxima
 *   vez que baje, avisa de nuevo.
 */
export interface TargetInput {
  price: number;
  target: number | null;
  notifiedPrice: number | null;
  minDropEur: number;
}

export function evaluateTarget(i: TargetInput): { notify: boolean; notifiedPrice: number | null } {
  if (i.target === null) return { notify: false, notifiedPrice: null };
  if (i.price > i.target) return { notify: false, notifiedPrice: null };
  if (i.notifiedPrice === null || i.price <= i.notifiedPrice - i.minDropEur) {
    return { notify: true, notifiedPrice: i.price };
  }
  return { notify: false, notifiedPrice: i.notifiedPrice };
}
