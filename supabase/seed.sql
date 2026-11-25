-- Datos de prueba de la fase 1 (ya aplicados en el proyecto de Supabase).
-- Crea la pareja, sus ajustes por defecto y el seguimiento de ejemplo del brief:
-- BCN → AGP, ida 1 ene, vuelta 7 ene, 1 pasajero, con maleta de cabina.
-- Cuando os registréis en la web, os unís a esta pareja con su código de invitación
-- (select invite_code from couples).
with c as (
  insert into public.couples (name) values ('Javier y su novia') returning id
), s as (
  insert into public.settings (couple_id) select id from c returning couple_id
)
insert into public.trackers (couple_id, origin, destination, outbound_date, return_date, passengers, with_baggage, notes)
select id, 'BCN', 'AGP', '2027-01-01', '2027-01-07', 1, true, 'Seguimiento de prueba (fase 1)' from c;
