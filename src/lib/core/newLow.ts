/**
 * Detección de "nuevo mínimo".
 *
 * - `lowest`: el precio más bajo visto desde que empezó el seguimiento.
 * - `notifiedLow`: el precio del último aviso de nuevo mínimo.
 *
 * Solo avisamos si el precio actual es un mínimo histórico Y ha bajado al menos
 * `minDropEur` € o `minDropPct` % respecto a la referencia (el último mínimo
 * avisado o, si nunca se ha avisado, el primer precio visto). Así varias bajadas
 * de 1 € se van acumulando hasta merecer un aviso.
 */
export interface NewLowInput {
  price: number;
  lowest: number | null;
  notifiedLow: number | null;
  /** Primer precio registrado del seguimiento (referencia si aún no se ha avisado). */
  firstPrice: number | null;
  minDropEur: number;
  minDropPct: number;
}

export interface NewLowResult {
  isFirstCheck: boolean;
  isHistoricLow: boolean;
  notify: boolean;
  reference: number | null;
  drop: number;
  dropPct: number;
  /** Nuevos valores a guardar. */
  lowest: number;
  notifiedLow: number | null;
}

export function evaluateNewLow(i: NewLowInput): NewLowResult {
  if (i.lowest === null) {
    return {
      isFirstCheck: true,
      isHistoricLow: true,
      notify: false,
      reference: null,
      drop: 0,
      dropPct: 0,
      lowest: i.price,
      notifiedLow: null,
    };
  }
  const isHistoricLow = i.price < i.lowest;
  const reference = i.notifiedLow ?? i.firstPrice ?? i.lowest;
  const drop = Math.round((reference - i.price) * 100) / 100;
  const dropPct = reference > 0 ? Math.round((drop / reference) * 10000) / 100 : 0;
  const notify = isHistoricLow && drop > 0 && (drop >= i.minDropEur || dropPct >= i.minDropPct);
  return {
    isFirstCheck: false,
    isHistoricLow,
    notify,
    reference,
    drop,
    dropPct,
    lowest: Math.min(i.lowest, i.price),
    notifiedLow: notify ? i.price : i.notifiedLow,
  };
}
