"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { checkNow, deleteTracker, markPurchased, setTrackerStatus, type ActionState } from "@/app/actions";

export function CheckNowButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});
  return (
    <div className="space-y-1">
      <button
        className="btn-secondary w-full"
        disabled={pending}
        onClick={() => start(async () => setMsg(await checkNow(id)))}
      >
        {pending ? "Comprobando… (puede tardar 20 s)" : "↻ Comprobar ahora"}
      </button>
      {msg.ok && <p className="text-center text-xs text-emerald-600">{msg.ok}</p>}
      {msg.error && <p className="text-center text-xs text-amber-600">{msg.error}</p>}
    </div>
  );
}

export function PurchaseForm({ id, suggested }: { id: string; suggested: number | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(markPurchased, {});
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn-primary w-full" onClick={() => setOpen(true)}>
        ✓ Ya lo compré
      </button>
    );
  return (
    <form action={action} className="card space-y-3">
      <input type="hidden" name="id" value={id} />
      <label className="field">
        <span>¿Cuánto pagasteis en total? (€)</span>
        <input
          name="purchased_price"
          inputMode="decimal"
          className="input"
          defaultValue={suggested ?? ""}
          required
          autoFocus
        />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancelar
        </button>
        <button className="btn-primary" disabled={pending}>
          Guardar
        </button>
      </div>
    </form>
  );
}

export function MoreActions({ id, status }: { id: string; status: string }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <Link href={`/seguimientos/${id}/editar`} className="btn-secondary">
        ✎ Editar
      </Link>
      {(status === "active" || status === "paused") && (
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() => start(() => setTrackerStatus(id, status === "active" ? "paused" : "active"))}
        >
          {status === "active" ? "⏸ Pausar" : "▶ Reanudar"}
        </button>
      )}
      <Link href={`/seguimientos/nuevo?from=${id}&invert=1`} className="btn-secondary">
        ⇄ Invertir sentido
      </Link>
      <Link href={`/seguimientos/nuevo?from=${id}`} className="btn-secondary">
        ⟳ Repetir viaje
      </Link>
      <button
        className={`col-span-2 ${confirmDelete ? "btn-primary bg-rose-600" : "btn-ghost text-rose-600"}`}
        disabled={pending}
        onClick={() => (confirmDelete ? start(() => deleteTracker(id)) : setConfirmDelete(true))}
      >
        {confirmDelete ? "Pulsa otra vez para borrar (se pierde el histórico)" : "Borrar seguimiento"}
      </button>
    </div>
  );
}
