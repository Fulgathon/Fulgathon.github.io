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
    name: 'Zona IT',
    code: 'ICEMAN10',
    offerUrl: '#',
    pitch:
      'Partenerul principal al Fulgathonului. [Oferta Zona IT pentru comunitate, de exemplu 10% reducere la periferice de gaming cu codul de mai jos, pe toată durata subathonului.]',
  },
  /**
   * Phase 2 backend (Supabase project "fulgathon", Frankfurt).
   * The publishable key is meant to be public: row level security decides
   * what it can read, and it can't write anything. Never put the secret /
   * service_role key in this repo.
   */
  supabase: {
    url: 'https://yvbxtsuddjqqoogdoqrx.supabase.co',
    publishableKey: 'sb_publishable_6pIaWU842o20RFTazgtv4w_a3joVlhS',
  },
  contactEmail: '[EMAIL CONTACT]',
  endDate: '[DATA FINALĂ]',
  bingoPrize: '[PREMIU]',
};
