// Site configuration: links, sponsor and the still-open placeholders.
// Values in [BRACKETS] are waiting on the owner (see CLAUDE.md, "Open").
// "#" links are placeholders too.

export const site = {
  channel: 'icemanlucky',
  links: {
    twitch: 'https://twitch.tv/icemanlucky',
    subscribe: 'https://twitch.tv/subs/icemanlucky',
    discord: '#',
    donate: '#',
    youtube: '#',
    tiktok: '#',
    instagram: '#',
    /** "Vezi clipul" links on completed challenges. */
    clip: '#',
  },
  sponsor: {
    /** Plain text standing in for the official logo. */
    logoText: 'ZONA IT',
    /** Official logo file in public/sponsors/ (e.g. '/sponsors/zona-it.svg'); empty shows the LOGO slot. */
    logo: '',
    name: 'Zona IT',
    code: 'ICEMAN10',
    offerUrl: '#',
    pitch:
      'Partenerul principal al IceMaratonului. [Oferta Zona IT pentru comunitate, de exemplu 10% reducere la periferice de gaming cu codul de mai jos, pe toată durata subathonului.]',
  },
  /**
   * The other two sponsor tiers (the main partner is `sponsor` above).
   *   Parteneri: up to 4, each backs one thing (wheel prizes, a milestone, Ora dublă, bingo).
   *   Susținători: any number, logo + link.
   * logo: a file in public/sponsors/ (SVG or PNG, ideally all-white on transparent),
   * e.g. '/sponsors/zona-it.svg'; without one the name is shown in a logo box.
   * When you add a sponsor here, also add it in Supabase so its clicks count:
   *   insert into private.known_sponsors (name) values ('Nume Sponsor');
   */
  partners: [
    { name: '[Partener 1]', role: 'Premii roată', url: '#', logo: '' },
    { name: '[Partener 2]', role: 'Milestones', url: '#', logo: '' },
    { name: '[Partener 3]', role: 'Ora dublă', url: '#', logo: '' },
    { name: '[Partener 4]', role: 'Bingo', url: '#', logo: '' },
  ] as { name: string; role: string; url: string; logo: string }[],
  supporters: Array.from({ length: 6 }, () => ({ name: '', url: '#', logo: '' })) as { name: string; url: string; logo: string }[],
  /**
   * Phase 2 backend (Supabase project "icemaraton", Frankfurt).
   * The publishable key is meant to be public: row level security decides
   * what it can read, and it can't write anything. Never put the secret /
   * service_role key in this repo.
   */
  supabase: {
    url: 'https://yvbxtsuddjqqoogdoqrx.supabase.co',
    publishableKey: 'sb_publishable_6pIaWU842o20RFTazgtv4w_a3joVlhS',
    /**
     * Turn on once the Twitch app is registered and its keys are saved in
     * Supabase (Authentication → Providers → Twitch). Until then the login
     * buttons say it's coming soon.
     */
    twitchLogin: true,
  },
  contactEmail: '[EMAIL CONTACT]',
  endDate: '[DATA FINALĂ]',
  bingoPrize: '[PREMIU]',
};
