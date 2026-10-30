// Her "transmission" panel and the ticker over her head. Everything put in them is text (lines,
// your prompt, Claude's answer, error output), so it only ever goes in through textContent and
// text nodes. The panel types its line out, a blip per syllable, with her visor face beside it.

import { drawGlyph } from './character/glyphs.js';
import { parseMarkdown, renderBlocks } from './markdown.js';

const GAP = 14;
const TYPE_MS = 22;     // per character
const PRIORITY = { alert: 3, error: 2, done: 2, work: 1, info: 1, idle: 0 };
// what gets a blip as it types: vowels, accented ones too, and kana and kanji (a syllable each)
export const VOICED = /[aeiouyàáâäãåæèéêëìíîïòóôöõøœùúûüýÿ\u3041-\u30ff\u3400-\u9fff]/i;

// Where the panel goes: above her if there's room, else beside her on the roomier side; always
// inside the area, never on top of her.
export function placePanel([ax, ay, aw, ah], size, area) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const cx = clamp(ax + aw / 2 - size.w / 2, area.x, area.x + area.w - size.w);
  if (ay - GAP - size.h >= area.y) return { x: cx, y: ay - GAP - size.h };
  const y = clamp(ay, area.y, area.y + area.h - size.h);
  const rightRoom = area.x + area.w - (ax + aw);
  const leftRoom = ax - area.x;
  if (rightRoom >= size.w + GAP && rightRoom >= leftRoom) return { x: ax + aw + GAP, y };
  if (leftRoom >= size.w + GAP) return { x: ax - GAP - size.w, y };
  // no room anywhere around her: below
  return { x: cx, y: clamp(ay + ah + GAP, area.y, area.y + area.h - size.h) };
}

const el = (doc, tag, className, text) => {
  const n = doc.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
};

export class Panel {
  constructor({ root, voice, glyphs, palette, now = () => performance.now() }) {
    this.root = root;
    this.doc = root.ownerDocument;
    this.voice = voice;
    this.glyphs = glyphs;
    this.palette = palette;
    this.now = now;
    this.current = null;
    this.nextId = 1;
    this.anchorRect = [0, 0, 0, 0];
    this.area = { x: 0, y: 0, w: 1920, h: 1080 };
    this.onClose = null;

    this.ticker = el(this.doc, 'div', 'hx-ticker');
    this.tickerVerb = el(this.doc, 'span', 'hx-ticker-verb');
    this.tickerTarget = el(this.doc, 'span', 'hx-ticker-target');
    this.ticker.append(this.tickerVerb, this.tickerTarget);
    this.ticker.hidden = true;
    root.appendChild(this.ticker);
  }

  // ---- the ticker ----

  setTicker(t) {
    this.tickerState = t || null;
    if (!t) {
      this.ticker.hidden = true;
      return;
    }
    this.ticker.hidden = false;
    this.ticker.className = `hx-ticker hx-ticker--${t.state || 'work'}`;
    this.tickerVerb.textContent = t.verb || '';
    this.tickerTarget.textContent = t.state === 'thinking' && Number.isFinite(t.seconds) ? `${t.seconds} s` : (t.target || '');
    this.place();
  }

  // ---- the panel ----

  // actions: [{ id, label, primary }]; onAction(id) when one is clicked, onDismiss() when the panel
  // goes away any other way (clicked, replaced, cleared)
  say({ kind = 'info', line = '', tag = '', face = 'calm', hold = 4500, quote = '', summary = '', reply = '', actions = [], onAction, onDismiss }) {
    if (this.current && (PRIORITY[this.current.kind] ?? 1) > (PRIORITY[kind] ?? 1) && this.current.hold === null) {
      return null; // an alert stays up until it's answered
    }
    this.hide();
    const doc = this.doc;
    const card = el(doc, 'div', `hx-panel hx-panel--${kind}`);
    const portrait = doc.createElement('canvas');
    portrait.className = 'hx-portrait';
    portrait.width = 96;
    portrait.height = 44;
    const body = el(doc, 'div', 'hx-body');
    const head = el(doc, 'div', 'hx-head');
    if (tag) head.appendChild(el(doc, 'span', 'hx-tag', tag));
    const lineEl = el(doc, 'div', 'hx-line', '');
    body.append(head, lineEl);
    if (quote) body.appendChild(el(doc, 'div', 'hx-quote', quote));
    if (summary) body.appendChild(el(doc, 'div', 'hx-summary', summary));
    if (reply) {
      const r = el(doc, 'div', 'hx-reply');
      r.appendChild(renderBlocks(parseMarkdown(reply), doc));
      body.appendChild(r);
    }
    const buttons = [];
    if (actions.length) {
      const row = el(doc, 'div', 'hx-actions');
      for (const a of actions) {
        const b = el(doc, 'button', a.primary ? 'hx-button hx-button--primary' : 'hx-button', a.label);
        b.type = 'button';
        b.addEventListener('click', (e) => {
          if (!e.isTrusted) return; // only your own click: never one a script made up
          e.stopPropagation(); // a button isn't also a click to close the panel
          this.hide({ answered: true });
          onAction?.(a.id);
        });
        row.appendChild(b);
        buttons.push([a.id, b]);
      }
      body.appendChild(row);
    }
    card.append(portrait, body);
    card.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });
    this.root.appendChild(card);

    const id = this.nextId++;
    this.current = { id, kind, line: String(line), shown: 0, card, lineEl, portrait, face, glitchUntil: this.now() + 90, start: this.now(), hold, doneAt: null, onDismiss, buttons };
    this.drawFace();
    this.place();
    return id;
  }

  clearKind(kind) {
    if (this.current?.kind === kind) this.hide();
  }

  hide({ answered = false } = {}) {
    const c = this.current;
    if (!c) return;
    c.card.remove();
    this.current = null;
    if (!answered) c.onDismiss?.();
  }

  setFace(face) {
    if (!this.current || this.current.face === face) return;
    this.current.face = face;
    this.current.glitchUntil = this.now() + 90;
  }

  drawFace() {
    const c = this.current;
    if (!c) return;
    const ctx = c.portrait.getContext('2d');
    ctx.clearRect(0, 0, c.portrait.width, c.portrait.height);
    ctx.fillStyle = this.palette.visor;
    ctx.fillRect(0, 0, c.portrait.width, c.portrait.height);
    // between two faces her portrait glitches for a beat
    const face = this.now() < c.glitchUntil ? 'loading' : c.face;
    drawGlyph(ctx, this.glyphs[face] || this.glyphs.calm, [6, 6, 84, 32], this.palette.amber);
  }

  // called every frame by app.js: types the line out and times the panel away
  update() {
    const c = this.current;
    if (!c) return;
    const now = this.now();
    const target = Math.min(c.line.length, Math.floor((now - c.start) / TYPE_MS));
    if (target > c.shown) {
      const typed = c.line.slice(c.shown, target);
      if (VOICED.test(typed)) this.voice?.play('blip');
      c.shown = target;
      c.lineEl.textContent = c.line.slice(0, c.shown);
      if (c.shown === c.line.length) c.doneAt = now;
    } else if (!c.line.length && c.doneAt === null) {
      c.doneAt = now;
    }
    this.drawFace();
    if (c.hold !== null && c.doneAt !== null && now - c.doneAt > c.hold) this.hide();
  }

  // next to her: app.js gives her current box and the screen's work area
  anchor(rect, area) {
    this.anchorRect = rect;
    this.area = area;
    this.place();
  }

  place() {
    const [ax, ay, aw] = this.anchorRect;
    if (!this.ticker.hidden) {
      const tw = this.ticker.offsetWidth || 160;
      this.ticker.style.left = `${Math.round(Math.min(Math.max(ax + aw / 2 - tw / 2, this.area.x), this.area.x + this.area.w - tw))}px`;
      this.ticker.style.top = `${Math.round(Math.max(this.area.y, ay - 30))}px`;
    }
    const c = this.current;
    if (!c) return;
    const size = { w: c.card.offsetWidth || 420, h: c.card.offsetHeight || 120 };
    const lifted = [ax, ay - (this.ticker.hidden ? 0 : 34), aw, this.anchorRect[3]];
    const p = placePanel(lifted, size, this.area);
    c.card.style.left = `${Math.round(p.x)}px`;
    c.card.style.top = `${Math.round(p.y)}px`;
  }

  // what takes clicks, for the overlay's clickable area: the panel (its buttons, a click to close
  // it); the ticker is only a label, so clicks go through it to what's underneath
  rects() {
    const card = this.current?.card;
    if (!card) return [];
    const r = card.getBoundingClientRect();
    return r.width && r.height ? [[r.left, r.top, r.width, r.height]] : [];
  }

  // where the current card's buttons are, by action id (for her debug state)
  buttonRects() {
    return (this.current?.buttons || []).map(([id, b]) => {
      const r = b.getBoundingClientRect();
      return { id, rect: [r.left, r.top, r.width, r.height] };
    });
  }
}
