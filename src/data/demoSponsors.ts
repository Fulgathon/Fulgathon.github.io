// Invented brands for demo mode only (?demo, /sponsori, /prezentare), so the partner
// wall can be seen full. None of these are real companies; the logos are original SVGs in
// public/sponsors/demo/. The public page always shows the real list from site.ts.
type Slot = { name: string; role: string; url: string; logo: string };
const L = (f: string) => `/sponsors/demo/${f}.svg`;

export const demoSponsors: { partners: Slot[]; supporters: Slot[] } = {
  partners: [
    { name: 'Glacio', role: 'Premii roată', url: '#', logo: L('glacio') },
    { name: 'Nordhaus PC', role: 'Milestones', url: '#', logo: L('nordhaus-pc') },
    { name: 'Polar Byte', role: 'Ora dublă', url: '#', logo: L('polar-byte') },
    { name: 'Fulg Coffee', role: 'Bingo', url: '#', logo: L('fulg-coffee') },
  ],
  supporters: [
    { name: 'Arctic Pizza', role: '', url: '#', logo: L('arctic-pizza') },
    { name: 'Crivăț Studio', role: '', url: '#', logo: L('crivat-studio') },
    { name: 'Iglu Print', role: '', url: '#', logo: L('iglu-print') },
    { name: 'Sania Shop', role: '', url: '#', logo: L('sania-shop') },
    { name: 'Brrr Wear', role: '', url: '#', logo: L('brrr-wear') },
    { name: 'Vârf Gym', role: '', url: '#', logo: L('varf-gym') },
  ],
};
