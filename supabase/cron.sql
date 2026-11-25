-- Programación del proceso horario con pg_cron + pg_net.
-- Se ejecuta UNA vez, cuando la web ya está desplegada en Vercel.
-- Sustituye <URL_DE_VERCEL> y <CRON_SECRET> (el mismo valor que en Vercel).
-- El secreto se guarda en Supabase Vault, no en el texto del cron.

select vault.create_secret('<CRON_SECRET>', 'cron_secret');
select vault.create_secret('https://<URL_DE_VERCEL>', 'app_url');

select cron.schedule(
  'vuelos-tick',
  '2 * * * *', -- cada hora, en el minuto 2
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/jobs/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- Limpieza semanal de la caché caducada y de respuestas antiguas de pg_net.
select cron.schedule('vuelos-cleanup', '30 4 * * 0', $$
  delete from public.provider_cache where expires_at < now() - interval '1 day';
$$);
