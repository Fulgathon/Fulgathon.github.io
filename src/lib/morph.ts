// Update a region in place instead of replacing its HTML: elements that stay keep
// their identity, so CSS transitions run (vote bars slide, selections fade, a
// tooltip stays open) and focus stays put. Elements match by tag + data-key, in
// order; anything else is replaced. Used by the render loop in src/scripts/app.ts.

const same = (a: Node, b: Node) =>
  a.nodeType === b.nodeType &&
  (a.nodeType !== 1 || ((a as Element).namespaceURI === (b as Element).namespaceURI &&
    (a as Element).tagName === (b as Element).tagName &&
    (a as Element).getAttribute('data-key') === (b as Element).getAttribute('data-key')));

function patchNode(cur: Node, next: Node) {
  if (cur.nodeType !== 1) {
    if (cur.nodeValue !== next.nodeValue) cur.nodeValue = next.nodeValue;
    return;
  }
  const c = cur as Element, n = next as Element;
  for (const { name } of [...c.attributes]) if (!n.hasAttribute(name)) c.removeAttribute(name);
  for (const { name, value } of [...n.attributes]) if (c.getAttribute(name) !== value) c.setAttribute(name, value);
  patchChildren(c, n);
}

function patchChildren(from: Node, to: Node) {
  const a = [...from.childNodes];
  const b = [...to.childNodes];
  b.forEach((next, i) => {
    const cur = a[i];
    if (!cur) from.appendChild(next);
    else if (same(cur, next)) patchNode(cur, next);
    else from.replaceChild(next, cur);
  });
  for (let i = b.length; i < a.length; i++) from.removeChild(a[i]);
}

export function morph(el: Element, html: string) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(el, tpl.content);
}
