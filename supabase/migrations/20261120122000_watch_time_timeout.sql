-- pg_net waits 5 s by default; a cold Edge Function start can take longer.
select cron.schedule('fulgathon-watch-time', '*/5 * * * *', $$
  select net.http_post(
    url := (select functions_url from private.settings where id = 1) || '/watch-time',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);
