-- =====================================================================
-- Vuelos BCN ⇄ AGP — esquema inicial
-- Todas las tablas se crean ya (aunque algunas se usen en fases
-- posteriores) para no tener que migrar datos más adelante.
-- El backend (procesos programados) usa la service_role, que salta RLS.
-- La web usa la clave publicable + sesión del usuario, limitada por RLS.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Pareja y usuarios
-- ---------------------------------------------------------------------
create table public.couples (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Nuestra pareja',
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  couple_id          uuid references public.couples (id) on delete set null,
  display_name       text,
  home_airport       text check (home_airport in ('BCN', 'AGP')),
  telegram_chat_id   bigint,
  telegram_link_code text unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_at         timestamptz not null default now()
);
create index profiles_couple_id_idx on public.profiles (couple_id);

-- Devuelve la pareja del usuario autenticado (se usa en las políticas RLS).
create or replace function public.my_couple_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select couple_id from public.profiles where id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Ajustes de la pareja
-- ---------------------------------------------------------------------
create table public.settings (
  couple_id               uuid primary key references public.couples (id) on delete cascade,
  timezone                text not null default 'Europe/Madrid',
  -- Coste del equipaje habitual por trayecto y pasajero, por aerolínea.
  baggage_by_airline      jsonb not null default '{"VY": {"label": "Maleta de cabina", "price": 0}, "FR": {"label": "Maleta de cabina (Priority)", "price": 0}}',
  notify_channels         jsonb not null default '{"telegram": true, "push": false, "email": false}',
  -- Avisos de seguimientos
  new_low_min_drop_eur    numeric(8,2) not null default 5,
  new_low_min_drop_pct    numeric(5,2) not null default 3,
  -- Detector de ofertas flash
  flash_enabled_anomaly   boolean not null default true,
  flash_enabled_threshold boolean not null default true,
  flash_min_dates_pct     numeric(5,2) not null default 25,
  flash_min_drop_pct      numeric(5,2) not null default 20,
  flash_threshold_price   numeric(8,2) not null default 20,
  flash_horizon_days      int not null default 90 check (flash_horizon_days between 7 and 180),
  flash_scan_times        text[] not null default array['09:00', '21:00'],
  flash_muted_until       timestamptz,
  daily_summary           boolean not null default false,
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Seguimientos
-- ---------------------------------------------------------------------
create table public.trackers (
  id                   uuid primary key default gen_random_uuid(),
  couple_id            uuid not null references public.couples (id) on delete cascade,
  traveler_id          uuid references public.profiles (id) on delete set null, -- null = viajamos los dos
  created_by           uuid references public.profiles (id) on delete set null,
  origin               text not null check (origin in ('BCN', 'AGP')),
  destination          text not null check (destination in ('BCN', 'AGP')),
  outbound_date        date not null,
  return_date          date,
  flex_days            int not null default 0 check (flex_days between 0 and 7),
  passengers           int not null default 1 check (passengers between 1 and 9),
  -- {"outbound": {"after": "09:00", "before": "23:59"}, "return": {"after": "17:00"}}
  time_filters         jsonb not null default '{}',
  with_baggage         boolean not null default true,
  target_price         numeric(8,2),
  check_interval_hours int check (check_interval_hours between 1 and 72), -- null = automático
  status               text not null default 'active' check (status in ('active', 'paused', 'purchased', 'expired')),
  muted_until          timestamptz,
  lowest_price         numeric(8,2),
  lowest_price_at      timestamptz,
  last_checked_at      timestamptz,
  next_check_at        timestamptz not null default now(),
  purchased_price      numeric(8,2),
  purchased_at         timestamptz,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (origin <> destination),
  check (return_date is null or return_date >= outbound_date)
);
create index trackers_couple_id_idx on public.trackers (couple_id);
create index trackers_traveler_id_idx on public.trackers (traveler_id);
create index trackers_created_by_idx on public.trackers (created_by);
create index trackers_due_idx on public.trackers (next_check_at) where status = 'active';

-- Cada comprobación de un seguimiento
create table public.price_checks (
  id              uuid primary key default gen_random_uuid(),
  tracker_id      uuid not null references public.trackers (id) on delete cascade,
  checked_at      timestamptz not null default now(),
  providers       text[] not null default '{}',
  currency        text not null default 'EUR',
  best_total      numeric(8,2),          -- precio base de la mejor combinación
  best_total_bags numeric(8,2),          -- con el equipaje habitual
  best_combo      jsonb,                 -- {outbound: Flight, return: Flight|null, ...}
  alternatives    jsonb,                 -- 3 siguientes combinaciones
  date_matrix     jsonb,                 -- matriz ida × vuelta si hay flexibilidad
  insights        jsonb,                 -- price_insights de Google
  prediction      jsonb,                 -- fase 5
  errors          jsonb
);
create index price_checks_tracker_idx on public.price_checks (tracker_id, checked_at desc);

-- Vuelos concretos vistos en cada comprobación
create table public.flight_quotes (
  id            bigint generated always as identity primary key,
  check_id      uuid not null references public.price_checks (id) on delete cascade,
  direction     text not null check (direction in ('outbound', 'return')),
  flight_date   date not null,
  airline       text not null check (airline in ('VY', 'FR')),
  flight_number text,
  dep_time      text,   -- hora local "HH:MM"
  arr_time      text,
  price         numeric(8,2) not null,
  currency      text not null default 'EUR',
  provider      text not null
);
create index flight_quotes_check_idx on public.flight_quotes (check_id);

-- ---------------------------------------------------------------------
-- Escaneo de la ruta (global, no depende de la pareja)
-- ---------------------------------------------------------------------
create table public.route_scans (
  id          bigint generated always as identity primary key,
  scan_id     uuid not null,            -- agrupa todas las filas de un mismo escaneo
  scanned_at  timestamptz not null default now(),
  direction   text not null check (direction in ('BCN-AGP', 'AGP-BCN')),
  airline     text not null check (airline in ('VY', 'FR')),
  flight_date date not null,
  min_price   numeric(8,2),             -- null = sin vuelos ese día
  currency    text not null default 'EUR',
  provider    text not null,
  unique (scan_id, direction, airline, flight_date)
);
create index route_scans_lookup_idx on public.route_scans (direction, airline, flight_date, scanned_at desc);
create index route_scans_scanned_at_idx on public.route_scans (scanned_at desc);

-- Ofertas flash detectadas
create table public.flash_sales (
  id             uuid primary key default gen_random_uuid(),
  couple_id      uuid not null references public.couples (id) on delete cascade,
  kind           text not null check (kind in ('anomaly', 'threshold')),
  airline        text not null check (airline in ('VY', 'FR')),
  direction      text check (direction in ('BCN-AGP', 'AGP-BCN')), -- null = ambos sentidos
  detected_at    timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  dates_affected date[] not null default '{}',
  avg_drop_pct   numeric(5,2),
  cheapest_dates jsonb,
  status         text not null default 'active' check (status in ('active', 'ended')),
  ended_at       timestamptz
);
create index flash_sales_couple_idx on public.flash_sales (couple_id, detected_at desc);

-- ---------------------------------------------------------------------
-- Avisos enviados
-- ---------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples (id) on delete cascade,
  tracker_id    uuid references public.trackers (id) on delete set null,
  flash_sale_id uuid references public.flash_sales (id) on delete set null,
  type          text not null check (type in ('new_low', 'target_price', 'rise_risk', 'flash_sale', 'daily_summary')),
  channel       text not null default 'telegram',
  recipients    uuid[] not null default '{}',
  dedupe_key    text,
  sent_at       timestamptz not null default now(),
  payload       jsonb not null default '{}'
);
create index notifications_couple_idx on public.notifications (couple_id, sent_at desc);
create index notifications_tracker_idx on public.notifications (tracker_id);
create index notifications_flash_idx on public.notifications (flash_sale_id);
create index notifications_dedupe_idx on public.notifications (dedupe_key, sent_at desc);

-- ---------------------------------------------------------------------
-- Infraestructura: uso de API, caché y registro de procesos
-- ---------------------------------------------------------------------
create table public.api_usage (
  provider text not null,
  day      date not null,
  purpose  text not null check (purpose in ('trackers', 'flash', 'manual')),
  calls    int not null default 0,
  primary key (provider, day, purpose)
);

create view public.api_usage_monthly
with (security_invoker = true) as
  select provider, date_trunc('month', day)::date as month, purpose, sum(calls)::int as calls
  from public.api_usage
  group by 1, 2, 3;

-- Incremento atómico del contador (lo llama el backend).
create or replace function public.increment_api_usage(p_provider text, p_purpose text, p_calls int default 1)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.api_usage (provider, day, purpose, calls)
  values (p_provider, (now() at time zone 'Europe/Madrid')::date, p_purpose, p_calls)
  on conflict (provider, day, purpose) do update set calls = public.api_usage.calls + excluded.calls
$$;
revoke execute on function public.increment_api_usage(text, text, int) from public, anon, authenticated;

create table public.provider_cache (
  key        text primary key,
  provider   text not null,
  response   jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index provider_cache_expires_idx on public.provider_cache (expires_at);

create table public.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'partial', 'error')),
  details     jsonb not null default '{}',
  errors      jsonb not null default '[]'
);
create index job_runs_job_idx on public.job_runs (job, started_at desc);

-- ---------------------------------------------------------------------
-- Alta de usuarios y creación / unión a la pareja
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- El primer usuario crea la pareja…
create or replace function public.create_couple(p_name text default 'Nuestra pareja')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_couple uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and couple_id is not null) then
    raise exception 'Ya perteneces a una pareja';
  end if;
  insert into public.couples (name) values (p_name) returning id into v_couple;
  insert into public.settings (couple_id) values (v_couple);
  update public.profiles set couple_id = v_couple where id = (select auth.uid());
  return v_couple;
end;
$$;

-- …y el segundo se une con el código de invitación (máximo 2 personas).
create or replace function public.join_couple(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_couple uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado';
  end if;
  select id into v_couple from public.couples where invite_code = upper(trim(p_invite_code));
  if v_couple is null then
    raise exception 'Código de invitación no válido';
  end if;
  if (select count(*) from public.profiles where couple_id = v_couple) >= 2 then
    raise exception 'Esta pareja ya está completa';
  end if;
  update public.profiles set couple_id = v_couple where id = (select auth.uid());
  return v_couple;
end;
$$;

revoke execute on function public.create_couple(text) from public, anon;
revoke execute on function public.join_couple(text) from public, anon;
grant execute on function public.create_couple(text) to authenticated;
grant execute on function public.join_couple(text) to authenticated;

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger trackers_touch before update on public.trackers for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.couples        enable row level security;
alter table public.profiles       enable row level security;
alter table public.settings       enable row level security;
alter table public.trackers       enable row level security;
alter table public.price_checks   enable row level security;
alter table public.flight_quotes  enable row level security;
alter table public.route_scans    enable row level security;
alter table public.flash_sales    enable row level security;
alter table public.notifications  enable row level security;
alter table public.api_usage      enable row level security;
alter table public.provider_cache enable row level security;
alter table public.job_runs       enable row level security;

-- Pareja
create policy "ver mi pareja" on public.couples
  for select to authenticated using (id = (select public.my_couple_id()));
create policy "renombrar mi pareja" on public.couples
  for update to authenticated using (id = (select public.my_couple_id()));

-- Perfiles: veo el mío y el de mi pareja; solo edito el mío.
create policy "ver perfiles de mi pareja" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or couple_id = (select public.my_couple_id()));
create policy "editar mi perfil" on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Ajustes
create policy "ver ajustes" on public.settings
  for select to authenticated using (couple_id = (select public.my_couple_id()));
create policy "editar ajustes" on public.settings
  for update to authenticated using (couple_id = (select public.my_couple_id()))
  with check (couple_id = (select public.my_couple_id()));

-- Seguimientos (CRUD completo dentro de la pareja)
create policy "seguimientos de mi pareja" on public.trackers
  for all to authenticated
  using (couple_id = (select public.my_couple_id()))
  with check (couple_id = (select public.my_couple_id()));

-- Histórico de comprobaciones (solo lectura)
create policy "ver comprobaciones" on public.price_checks
  for select to authenticated
  using (exists (select 1 from public.trackers t where t.id = tracker_id and t.couple_id = (select public.my_couple_id())));
create policy "ver vuelos de comprobaciones" on public.flight_quotes
  for select to authenticated
  using (exists (
    select 1 from public.price_checks c join public.trackers t on t.id = c.tracker_id
    where c.id = check_id and t.couple_id = (select public.my_couple_id())));

-- Datos globales de la ruta: lectura para usuarios autenticados.
create policy "ver escaneos" on public.route_scans for select to authenticated using (true);
create policy "ver uso de api" on public.api_usage for select to authenticated using (true);
create policy "ver procesos" on public.job_runs for select to authenticated using (true);
-- provider_cache: sin políticas → solo el backend.

create policy "ver ofertas" on public.flash_sales
  for select to authenticated using (couple_id = (select public.my_couple_id()));
create policy "ver avisos" on public.notifications
  for select to authenticated using (couple_id = (select public.my_couple_id()));
