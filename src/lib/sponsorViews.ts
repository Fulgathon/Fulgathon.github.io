// Sponsors from /mod (public_state part 'sponsors'), drawn into the same markup as
// Hero.astro / PartnerRow.astro / PartnerWall.astro. Until moderators set them up, the page
// keeps the static list from src/data/site.ts. Every slot stays visible, empty ones as «LOGO»
// (owner, 23 Nov: sponsors and viewers should see every place there is).
import type { Sponsor } from '../data/types';

export const PARTNER_SLOTS = 4;
export const SUPPORTER_SLOTS = 6;

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cond = "'Barlow Condensed', sans-serif";

/** The sponsors to show now, on the site or on the overlay (flag + visibility window). */
export function visibleSponsors(list: Sponsor[] | null | undefined, now: number, where: 'site' | 'overlay'): Sponsor[] {
  return (list ?? []).filter((s) => s[where] && (s.from === null || s.from <= now) && (s.until === null || s.until > now));
}

export const mainOf = (list: Sponsor[]) => list.find((s) => s.tier === 'main') ?? null;
/** The code is shown until the offer ends. */
export const codeOf = (s: Sponsor | null, now: number) => (s?.code && (s.offerUntil === null || s.offerUntil > now) ? s.code : null);

const track = (s: Sponsor) => (s.url ? ` data-track="${esc(s.name)}|click"` : '');
const href = (s: Sponsor | null, fallback = '#') => esc(s?.url ?? fallback);

/** «Prezentat de» + «Împreună cu» under the title. */
export function sponsorLineHtml(list: Sponsor[]): string {
  const main = mainOf(list);
  const partners = list.filter((s) => s.tier === 'partner');
  const slots = [...partners, ...Array.from({ length: Math.max(0, PARTNER_SLOTS - partners.length) }, () => null)];
  const mainHtml = `<a id="prezentat" class="title-sponsor" href="${main?.url ? href(main) : '#oferta'}"${main ? track(main) : ''}>
    <span class="ts-l">Prezentat de</span>
    ${main?.logo ? `<img class="ts-logo" src="${esc(main.logo)}" alt="${esc(main.name)}" />` : `<span class="ts-name" data-sponsor="logo">${esc((main?.name ?? 'LOGO').toUpperCase())}</span>`}
  </a>`;
  const row = `<div class="title-partners"><span class="tp-l">Împreună cu</span><ul class="tp-list">${slots.map((p) => `<li>${p
    ? `<a class="tp" href="${href(p)}"${track(p)} title="${esc(p.role ? `${p.name} · ${p.role}` : p.name)}">${p.logo ? `<img src="${esc(p.logo)}" alt="${esc(p.name)}" height="40" />` : `<span class="tp-empty"><span class="sr-only">${esc(p.name)}</span><span aria-hidden="true">${esc(p.name.toUpperCase())}</span></span>`}</a>`
    : '<span class="tp"><span class="tp-empty"><span class="sr-only">Loc liber pentru un partener</span><span aria-hidden="true">LOGO</span></span></span>'}</li>`).join('')}</ul></div>`;
  return mainHtml + `<div>${row}</div>`;
}

/** The partner wall: main partner, partners, supporters. */
export function partnerWallHtml(list: Sponsor[]): string {
  const main = mainOf(list);
  const partners = list.filter((s) => s.tier === 'partner');
  const supporters = list.filter((s) => s.tier === 'supporter');
  const pSlots = [...partners, ...Array.from({ length: Math.max(0, PARTNER_SLOTS - partners.length) }, () => null)];
  const sSlots = [...supporters, ...Array.from({ length: Math.max(0, SUPPORTER_SLOTS - supporters.length) }, () => null)];
  const tileStyle = 'height: 56px; display: grid; place-items: center; background: #090C11; border: 1px solid #1C2230';
  return `<div class="pw-grid">
    <a class="pw-main ptile" href="${main?.url ? href(main) : '#oferta'}"${main ? track(main) : ''}>
      <span class="pw-tier">Partener principal</span>
      ${main?.logo ? `<img src="${esc(main.logo)}" alt="${esc(main.name)}" loading="lazy" style="max-width: 70%; max-height: 72px; object-fit: contain" />` : `<span class="pw-main-name" data-sponsor="logo">${esc((main?.name ?? 'LOGO').toUpperCase())}</span>`}
    </a>
    ${pSlots.map((p) => p ? `<a class="pw-tile ptile" href="${href(p)}"${track(p)}>
        ${p.logo ? `<span class="pw-logo"><img src="${esc(p.logo)}" alt="${esc(p.name)}" loading="lazy" decoding="async" style="max-width: 80%; max-height: 44px; object-fit: contain" /></span>` : '<span class="pw-logo pw-empty">LOGO</span>'}
        <span class="pw-meta"><strong>${esc(p.name)}</strong><span>${esc(p.role ?? '')}</span></span>
      </a>` : `<span class="pw-tile ptile"><span class="pw-logo pw-empty">LOGO</span><span class="pw-meta"><strong>Loc liber</strong><span>Partener</span></span></span>`).join('')}
  </div>
  <p class="pw-sub">Susținători</p>
  <div class="stiles">${sSlots.map((s) => s
    ? (s.logo
      ? `<a class="ptile" href="${href(s)}"${track(s)} style="${tileStyle}"><img src="${esc(s.logo)}" alt="${esc(s.name)}" loading="lazy" decoding="async" style="max-width: 80%; max-height: 36px; object-fit: contain" /></a>`
      : `<a class="ptile" href="${href(s)}"${track(s)} style="${tileStyle}; font-family: ${cond}; font-weight: 800; font-size: 12px; letter-spacing: 0.1em; color: #AEB8C7; text-decoration: none">${esc(s.name.toUpperCase())}</a>`)
    : `<span class="ptile" style="${tileStyle}; font-family: ${cond}; font-weight: 800; font-size: 12px; letter-spacing: 0.1em; color: #7D8899">LOGO</span>`).join('')}</div>`;
}

/** A string that changes when anything shown changes (to redraw only then). */
export const sponsorKey = (list: Sponsor[], now: number) => JSON.stringify([list.map((s) => [s.id, s.name, s.logo, s.url, s.role, s.tier, s.description, s.cta]), codeOf(mainOf(list), now)]);
