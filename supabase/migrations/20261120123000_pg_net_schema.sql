-- Security advisor: keep extensions out of the public schema.
-- (pg_net's functions live in the "net" schema either way; the cron job calls net.http_post.)
drop extension if exists pg_net;
create extension pg_net schema extensions;
