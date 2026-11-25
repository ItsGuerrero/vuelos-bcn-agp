-- Referencias para el aviso de "nuevo mínimo" (ver src/lib/core/newLow.ts):
-- first_price: primer precio visto; notified_low: precio del último aviso enviado.
alter table public.trackers
  add column first_price  numeric(8,2),
  add column notified_low numeric(8,2);
