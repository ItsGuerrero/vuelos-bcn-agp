-- Fase 3: avisos.
-- target_notified_price: precio del último aviso de "precio objetivo" (null = no avisado o
-- el precio volvió a subir por encima del objetivo).
alter table public.trackers add column target_notified_price numeric(8,2);
