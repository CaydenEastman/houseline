// Minimal stub DOM: just enough for the app shell and views. Not a browser; no layout, no CSS.
const VOID = new Set(['input', 'br', 'img', 'hr']);
class Node_ { constructor() { this.parentNode = null; this.childNodes = []; } }
export class Text extends Node_ {
  constructor(t) { super(); this.nodeType = 3; this.data = String(t); }
  get textContent() { return this.data; } set textContent(v) { this.data = String(v); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}
function parseSel(sel) {
  return sel.split(',').map((part) => {
    const toks = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/); const out = []; let child = false;
    for (const t of toks) { if (t === '>') { child = true; continue; } out.push({ child, compound: parseCompound(t) }); child = false; }
    return out;
  });
}
function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  const re = /(^[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w:-]+)(?:([~|^$*]?=)"?([^"\]]*)"?)?\]|:not\(([^)]*)\)|:[\w-]+/g; let m;
  while ((m = re.exec(s))) {
    if (m[1]) c.tag = m[1].toLowerCase(); else if (m[2]) c.id = m[2]; else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push([m[4], m[5], m[6]]); else if (m[7]) c.nots.push(parseCompound(m[7]));
  }
  return c;
}
function matchCompound(el, c) {
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const [n, op, v] of c.attrs) {
    if (!el.hasAttribute(n)) return false;
    const a = el.getAttribute(n);
    if (op === '=' && a !== v) return false; if (op === '*=' && !a.includes(v)) return false;
    if (op === '^=' && !a.startsWith(v)) return false; if (op === '$=' && !a.endsWith(v)) return false;
  }
  for (const n of c.nots) if (matchCompound(el, n)) return false;
  return true;
}
function matchChain(el, chain, i = chain.length - 1, root = null) {
  if (!matchCompound(el, chain[i].compound)) return false;
  if (i === 0) return true;
  let p = el.parentNode;
  if (chain[i].child) return !!p && p.nodeType === 1 && matchChain(p, chain, i - 1, root);
  while (p && p.nodeType === 1) { if (matchChain(p, chain, i - 1, root)) return true; p = p.parentNode; }
  return false;
}
export class Element extends Node_ {
  constructor(doc, tag) {
    super(); this.nodeType = 1; this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this._attrs = new Map(); this._ev = {};
    this.style = {}; this._value = undefined; this.checked = false; this.open = false;
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      add: (...cs) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); self.className = [...s].join(' '); },
      remove: (...cs) => { self.className = self.className.split(/\s+/).filter((c) => c && !cs.includes(c)).join(' '); },
      toggle: (c, f) => { const has = self.classList.contains(c); const want = f ?? !has; self.classList[want ? 'add' : 'remove'](c); return want; },
    };
    this.dataset = new Proxy({}, { get: (_, k) => self.getAttribute('data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())), set: (_, k, v) => { self.setAttribute('data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v); return true; } });
  }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') { const os = this.querySelectorAll('option'); const o = os.find((x) => x.hasAttribute('selected')) || os[0]; return o ? (o.getAttribute('value') ?? o.textContent) : ''; }
    return '';
  }
  set value(v) { this._value = String(v); }
  get className() { return this._attrs.get('class') ?? ''; } set className(v) { this._attrs.set('class', String(v)); }
  get id() { return this._attrs.get('id') ?? ''; } set id(v) { this._attrs.set('id', String(v)); }
  get hidden() { return this._attrs.has('hidden'); } set hidden(v) { v ? this._attrs.set('hidden', '') : this._attrs.delete('hidden'); }
  get disabled() { return this._attrs.has('disabled'); } set disabled(v) { v ? this._attrs.set('disabled', '') : this._attrs.delete('disabled'); }
  get type() { return this._attrs.get('type') ?? ''; } set type(v) { this._attrs.set('type', v); }
  get name() { return this._attrs.get('name') ?? ''; }
  get title() { return this._attrs.get('title') ?? ''; } set title(v) { this._attrs.set('title', v); }
  get placeholder() { return this._attrs.get('placeholder') ?? ''; } set placeholder(v) { this._attrs.set('placeholder', v); }
  get href() { return this._attrs.get('href') ?? ''; } set href(v) { this._attrs.set('href', v); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] ?? null; } get lastChild() { return this.childNodes.at(-1) ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement || n === this.ownerDocument.body; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; if (v !== '' && v != null) this._adopt(new Text(v)); }
  get innerText() { return this.textContent; }
  get options() { return this.querySelectorAll('option'); }
  get selectedIndex() { return 0; }
  _adopt(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  _conv(x) { return typeof x === 'string' || typeof x === 'number' ? new Text(x) : x; }
  append(...ns) { for (const n of ns.flat()) if (n != null && n !== false) this._adopt(this._conv(n)); }
  appendChild(n) { return this._adopt(n); }
  prepend(...ns) { for (const n of ns.reverse()) { const c = this._conv(n); if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.unshift(c); } }
  replaceChildren(...ns) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; this.append(...ns); }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i < 0) throw new Error('removeChild: not a child'); this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  insertBefore(n, ref) { if (!ref) return this._adopt(n); if (n.parentNode) n.parentNode.removeChild(n); const i = this.childNodes.indexOf(ref); this.childNodes.splice(i, 0, n); n.parentNode = this; return n; }
  after(...ns) { const p = this.parentNode; let ref = this; for (const n of ns) { p.insertBefore(this._conv(n), ref.nextSibling); ref = n; } }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] ?? null : null; }
  replaceWith(n) { this.parentNode.insertBefore(n, this); this.remove(); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  setAttribute(k, v) { this._attrs.set(k, String(v)); if (k === 'value') this._value = String(v); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  hasAttribute(k) { return this._attrs.has(k); } removeAttribute(k) { this._attrs.delete(k); }
  toggleAttribute(k, f) { const want = f ?? !this._attrs.has(k); want ? this._attrs.set(k, '') : this._attrs.delete(k); return want; }
  addEventListener(t, fn) { (this._ev[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._ev[t] = (this._ev[t] || []).filter((f) => f !== fn); }
  dispatchEvent(e) {
    e.target ||= this; e.currentTarget = this;
    for (const f of [...(this._ev[e.type] || [])]) f.call(this, e);
    if (e.bubbles && this.parentNode && this.parentNode.dispatchEvent && !e._stop) this.parentNode.dispatchEvent(e);
    return true;
  }
  click() { const e = { type: 'click', bubbles: true, target: this, preventDefault() {}, stopPropagation() { this._stop = true; } }; this.dispatchEvent(e); }
  focus() { this.ownerDocument.activeElement = this; } blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  select() {} scrollIntoView() {} showModal() { this.open = true; this.setAttribute('open', ''); } show() { this.showModal(); }
  close() { const was = this.open; this.open = false; this.removeAttribute('open'); if (was) this.dispatchEvent({ type: 'close', bubbles: false, target: this, preventDefault() {}, stopPropagation() {} }); } // like a browser: 'close' fires when an open dialog closes
  matches(sel) { return parseSel(sel).some((ch) => matchChain(this, ch)); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) {
    const chains = parseSel(sel), out = [];
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (chains.some((ch) => matchChain(c, ch))) out.push(c); walk(c); } };
    walk(this); return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
  get outerHTML() { const a = [...this._attrs].map(([k, v]) => ` ${k}="${v}"`).join(''); const t = this.tagName.toLowerCase(); return VOID.has(t) ? `<${t}${a}>` : `<${t}${a}>${this.childNodes.map((n) => n.outerHTML ?? n.data).join('')}</${t}>`; }
}
export function makeDocument() {
  const doc = {
    nodeType: 9, hidden: false, _ev: {}, activeElement: null,
    createElement: (t) => new Element(doc, t), createTextNode: (t) => new Text(t),
    createDocumentFragment: () => new Element(doc, 'fragment'),
    getElementById: (id) => doc.body.querySelectorAll('#' + id)[0] ?? null,
    querySelector: (s) => doc.body.querySelector(s), querySelectorAll: (s) => doc.body.querySelectorAll(s),
    addEventListener(t, f) { (doc._ev[t] ||= []).push(f); }, removeEventListener() {},
    get title() { return ''; }, set title(_) {},
  };
  doc.body = new Element(doc, 'body'); doc.documentElement = new Element(doc, 'html'); doc.documentElement.append(doc.body);
  doc.activeElement = doc.body;
  // mirror index.html shell
  const mk = (tag, id, attrs = {}, parent = doc.body) => { const e = doc.createElement(tag); e.id = id; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.append(e); return e; };
  const header = mk('header', 'hdr'); mk('div', 'header-actions', {}, header); mk('button', 'add-btn', { type: 'button' }, header); mk('button', 'settings-btn', { type: 'button' }, header);
  const app = mk('div', 'app', { hidden: '' }); mk('section', 'today-strip', {}, app); mk('nav', 'nav', {}, app); mk('main', 'main', { tabindex: '-1' }, app);
  mk('div', 'wizard', { hidden: '' }); mk('div', 'status');
  for (const d of ['task-dialog', 'complete-dialog', 'settings-dialog', 'confirm-dialog']) mk('dialog', d);
  return doc;
}
