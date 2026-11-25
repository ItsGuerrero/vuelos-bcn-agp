-- Ajustes de seguridad tras revisar los avisos de Supabase.

-- pg_net fuera del esquema public.
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;

-- El trigger de alta no debe poder llamarse por la API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- my_couple_id solo para usuarios autenticados (lo necesitan las políticas RLS).
revoke execute on function public.my_couple_id() from public, anon;
grant execute on function public.my_couple_id() to authenticated;

-- provider_cache es interna: lo dejamos explícito con una política que no permite nada.
create policy "solo backend" on public.provider_cache for select to authenticated using (false);
