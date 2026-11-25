-- Fase 4: detector de ofertas flash.

alter table public.flash_sales
  add column min_price numeric(8,2),
  add column notified_min_price numeric(8,2),
  add column items jsonb not null default '[]';

-- Último precio conocido de cada fecha, sentido y aerolínea (escaneos de los últimos 3 días).
create or replace function public.route_latest_prices()
returns table (direction text, airline text, flight_date date, min_price numeric, scanned_at timestamptz, scan_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (r.direction, r.airline, r.flight_date)
    r.direction, r.airline, r.flight_date, r.min_price, r.scanned_at, r.scan_id
  from public.route_scans r
  where r.scanned_at > now() - interval '3 days'
    and r.flight_date >= (now() at time zone 'Europe/Madrid')::date
  order by r.direction, r.airline, r.flight_date, r.scanned_at desc
$$;

-- Precio de referencia: mediana de los escaneos de los últimos N días para cada fecha,
-- SIN contar el último escaneo de cada aerolínea (que es el que se compara).
create or replace function public.route_baselines(p_days int default 30)
returns table (direction text, airline text, flight_date date, median numeric, n int)
language sql
stable
security invoker
set search_path = ''
as $$
  with latest as (
    select distinct on (airline) airline, scan_id
    from public.route_scans
    where scanned_at > now() - interval '3 days'
    order by airline, scanned_at desc
  )
  select r.direction, r.airline, r.flight_date,
         percentile_cont(0.5) within group (order by r.min_price)::numeric as median,
         count(*)::int as n
  from public.route_scans r
  where r.scanned_at > now() - make_interval(days => p_days)
    and r.min_price is not null
    and not exists (select 1 from latest l where l.airline = r.airline and l.scan_id = r.scan_id)
  group by r.direction, r.airline, r.flight_date
$$;

grant execute on function public.route_latest_prices() to authenticated;
grant execute on function public.route_baselines(int) to authenticated;
