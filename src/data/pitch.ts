// Content of the sponsor presentation (/sponsori). Values in [BRACKETS] are
// waiting on Iceman (real audience numbers, prices); everything else is how
// the site already works.

export const pitch = {
  /** Shown on the first step. Replace with real numbers from Twitch analytics. */
  audience: [
    { value: '[URMĂRITORI]', label: 'urmăritori pe Twitch' },
    { value: '[MEDIE]', label: 'viewers în medie pe stream' },
    { value: '[VÂRF]', label: 'viewers la vârf' },
    { value: '22 de zile', label: '20 decembrie – 10 ianuarie, cu cronometru care crește' },
  ],
  packages: [
    {
      name: 'Partener principal',
      seats: '1 loc',
      price: '[la cerere]',
      highlight: true,
      items: [
        '«Prezentat de» chiar sub cronometru, pe site',
        'Prima secțiune după cronometru: oferta voastră, codul de reducere, linkul',
        'Ora dublă oferită de voi (cea mai intensă oră a zilei), de mai multe ori pe săptămână',
        'Coduri secrete oferite de voi pe stream',
        'Premiile mari de pe roată «de la» voi',
        'Mențiune discretă în overlay la fiecare 10 minute',
        'Raport complet la final',
      ],
    },
    {
      name: 'Partener',
      seats: 'până la 4',
      price: '[la cerere]',
      highlight: false,
      items: [
        'Logo și link în secțiunea de parteneri',
        'Un moment al vostru: Ora dublă, premii pe roată, un milestone sau bingo',
        'Coduri secrete oferite de voi',
        'Raport cu click-uri, coduri și momentele voastre',
      ],
    },
    {
      name: 'Susținător',
      seats: 'nelimitat',
      price: '[la cerere]',
      highlight: false,
      items: [
        'Logo în lista de susținători',
        'Un premiu pe roată sau la bingo, «de la» voi',
        'Raport de bază',
      ],
    },
  ],
  extras: [
    { title: 'Dublăm donațiile', text: 'Într-o fereastră anunțată, dublați donațiile comunității până la o sumă aleasă de voi. Cel mai puternic motiv să doneze cineva atunci.' },
    { title: 'Segment dedicat', text: '20–30 de minute de conținut adevărat cu produsele voastre (de exemplu un upgrade de setup votat de chat). Rămâne și ca clip.' },
    { title: 'Obiectiv comunitar', text: 'Dacă comunitatea atinge o sumă până la o dată, voi oferiți premii la sorți pentru toți cei care au jucat.' },
  ],
};
