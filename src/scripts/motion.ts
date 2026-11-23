// Site motion, «tăietura» (the broadcast cut). The tokens live in global.css
// (--m-ease, --m-fast/base/slow, --m-skew); this file does the parts CSS can't:
//   * in-page links (menu, logo, buttons) glide to their section with an eased
//     scroll that starts quick and lands softly, then focus the section;
//   * the menu marks the section you're in (aria-current, slanted underline);
//   * section headers play their cut-in the first time they scroll into view,
//     and again when a menu link lands on them.
// With prefers-reduced-motion: links jump, headers are simply there.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
if (!reduce.matches) root.classList.add('motion');
reduce.addEventListener('change', () => root.classList.toggle('motion', !reduce.matches));

// Same curve as --m-ease-io: cubic-bezier(.65, 0, .35, 1), close to a cubic in-out.
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

let frame = 0;
const stop = () => cancelAnimationFrame(frame);
// The visitor takes over: any wheel, touch or key stops the glide.
['wheel', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, stop, { passive: true }));

function cutIn(el: Element) {
  const head = el.matches('.shead') ? el : el.querySelector('.shead');
  if (!head || !root.classList.contains('motion')) return;
  head.classList.remove('seen');
  void (head as HTMLElement).offsetWidth;   // restart the transition
  head.classList.add('seen');
}

function land(el: HTMLElement) {
  if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  cutIn(el);
}

/** Scroll to a section: eased, 450–900 ms depending on the distance. */
export function glideTo(el: HTMLElement) {
  stop();
  // Let the browser find the landing spot (it applies scroll-margin-top and the 2K/4K
  // page zoom correctly), then jump back; both happen before the next paint.
  const from = window.scrollY;
  el.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
  const to = window.scrollY;
  window.scrollTo({ top: from, behavior: 'instant' as ScrollBehavior });
  const dist = to - from;
  if (reduce.matches || Math.abs(dist) < 2) { window.scrollTo({ top: to, behavior: 'instant' as ScrollBehavior }); land(el); return; }
  const ms = Math.min(900, Math.max(450, Math.abs(dist) * 0.28));
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    window.scrollTo({ top: from + dist * easeInOut(t), behavior: 'instant' as ScrollBehavior });
    if (t < 1) frame = requestAnimationFrame(step);
    else land(el);
  };
  frame = requestAnimationFrame(step);
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!a || a.hash.length < 2) return;
  const el = document.getElementById(decodeURIComponent(a.hash.slice(1)));
  if (!el) return;
  e.preventDefault();
  if (location.hash !== a.hash) history.pushState(null, '', a.hash);
  // Next frame: the phone menu has closed by then, so the target sits where it will stay.
  requestAnimationFrame(() => glideTo(el));
});

// Headers: cut-in the first time each one comes into view.
const heads = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('seen'); heads.unobserve(en.target); } });
}, { rootMargin: '0px 0px -12% 0px' });
document.querySelectorAll('.shead').forEach((h) => heads.observe(h));

// Menu: mark the section under the sticky bar.
const links = [...document.querySelectorAll<HTMLAnchorElement>('#main-nav .navlink, #mobile-menu .navlink')];
const ids = [...new Set(links.map((a) => a.hash.slice(1)).filter(Boolean))];
const sections = ids.map((id) => document.getElementById(id)).filter((x): x is HTMLElement => !!x);
const visible = new Map<string, boolean>();
const spy = new IntersectionObserver((entries) => {
  entries.forEach((en) => visible.set(en.target.id, en.isIntersecting));
  const current = sections.find((s) => visible.get(s.id))?.id ?? null;
  links.forEach((a) => (a.hash.slice(1) === current ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
}, { rootMargin: '-35% 0px -60% 0px' });
sections.forEach((s) => spy.observe(s));
