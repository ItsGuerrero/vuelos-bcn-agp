-- Seguridad: desde la web, un usuario solo puede cambiar su nombre y su aeropuerto.
-- couple_id (solo vía create_couple/join_couple) y los campos de Telegram (solo el backend)
-- quedan fuera, para que nadie pueda colarse en otra pareja editando su perfil.
revoke update on public.profiles from authenticated, anon;
grant update (display_name, home_airport) on public.profiles to authenticated;
