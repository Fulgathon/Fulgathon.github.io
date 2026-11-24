-- «Sponsori de test» (owner, 24 Nov 2026): during «Mod test» a moderator fills the sponsor list with the
-- invented brands from public/sponsors/demo/ (1 main partner, 5 partners, 4 supporters, with logos), so
-- the site, the partner wall and the «Camera de control» strip look exactly as they will live, carousels
-- included. Only while a test runs: «Oprește testul» puts the real sponsors back (public.sponsors and the
-- 'sponsors' part are restored like every other table).

create or replace function public.mod_test_sponsors()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if not private.test_active() then raise exception 'test_off' using errcode = 'P0001'; end if;
  delete from public.sponsors where id is not null;
  insert into public.sponsors (tier, position, name, logo_url, role, description, url, cta, code, code_note, overlay_line)
  values
    ('main', 0, 'Nordhaus PC', '/sponsors/demo/nordhaus-pc.svg', null, 'Sponsor de test: așa arată partenerul principal.', null, 'Vezi oferta', 'TEST10', '10% reducere (test)', 'calculatoare de gaming (test)'),
    ('partner', 1, 'Glacio', '/sponsors/demo/glacio.svg', 'Premii roată', null, null, null, null, null, null),
    ('partner', 2, 'Polar Byte', '/sponsors/demo/polar-byte.svg', 'Ora dublă', null, null, null, null, null, null),
    ('partner', 3, 'Fulg Coffee', '/sponsors/demo/fulg-coffee.svg', 'Bingo', null, null, null, null, null, null),
    ('partner', 4, 'Iglu Print', '/sponsors/demo/iglu-print.svg', 'Milestones', null, null, null, null, null, null),
    ('partner', 5, 'Sania Shop', '/sponsors/demo/sania-shop.svg', 'Donează și alegi', null, null, null, null, null, null),
    ('supporter', 1, 'Arctic Pizza', '/sponsors/demo/arctic-pizza.svg', null, null, null, null, null, null, null),
    ('supporter', 2, 'Crivăț Studio', '/sponsors/demo/crivat-studio.svg', null, null, null, null, null, null, null),
    ('supporter', 3, 'Brrr Wear', '/sponsors/demo/brrr-wear.svg', null, null, null, null, null, null, null),
    ('supporter', 4, 'Vârf Gym', '/sponsors/demo/varf-gym.svg', null, null, null, null, null, null, null);
  perform private.sponsors_publish();
end; $$;
revoke all on function public.mod_test_sponsors() from public, anon;
grant execute on function public.mod_test_sponsors() to authenticated;
