-- Short phrase for the "Ultimele premii" list: "<user> a câștigat <win_label>".
alter table public.prizes add column win_label text;

update public.prizes set win_label = v.label
from (values
  (0, '+5 minute pe cronometru'),
  (1, 'VIP 24 de ore'),
  (2, 'un shoutout live'),
  (3, 'un sub cadou de la Iceman'),
  (4, 'alegerea următorului joc'),
  (5, 'o colindă de la Iceman'),
  (6, 'cronometrul înghețat 5 minute'),
  (7, 'nimic de data asta')
) as v (position, label)
where prizes.position = v.position;

alter table public.prizes alter column win_label set not null;
