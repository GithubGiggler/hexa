// A small, safe markdown reader for Claude's answers: paragraphs, headings (shown bold), lists,
// fenced code, bold, italics, inline code and link text. Everything else is plain text: markup in
// the input is shown as characters, never interpreted, and nothing is ever set as HTML.

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]*\)|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/;

export function parseInline(text) {
  const out = [];
  let rest = String(text);
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ type: 'text', text: rest });
      break;
    }
    if (m.index) out.push({ type: 'text', text: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__')) out.push({ type: 'strong', text: tok.slice(2, -2) });
    else if (tok.startsWith('`')) out.push({ type: 'code', text: tok.slice(1, -1) });
    else if (tok.startsWith('[')) out.push({ type: 'link', text: tok.slice(1, tok.indexOf('](')) });
    else out.push({ type: 'em', text: tok.slice(1, -1) });
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', inline: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      const code = [];
      for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const type = bullet ? 'ul' : 'ol';
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push(parseInline((bullet || numbered)[1]));
      continue;
    }
    flushList();
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ type: 'p', inline: [{ type: 'strong', text: heading[1] }] });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

const TAGS = { strong: 'strong', em: 'em', code: 'code', link: 'span' };

function inlineNodes(parent, inline, doc) {
  for (const n of inline) {
    if (n.type === 'text') {
      parent.appendChild(doc.createTextNode(n.text));
      continue;
    }
    const el = doc.createElement(TAGS[n.type]);
    if (n.type === 'link') el.className = 'hx-link';
    el.textContent = n.text;
    parent.appendChild(el);
  }
}

export function renderBlocks(blocks, doc = document) {
  const frag = doc.createDocumentFragment();
  for (const b of blocks) {
    if (b.type === 'p') {
      const p = doc.createElement('p');
      inlineNodes(p, b.inline, doc);
      frag.appendChild(p);
    } else if (b.type === 'ul' || b.type === 'ol') {
      const list = doc.createElement(b.type);
      for (const item of b.items) {
        const li = doc.createElement('li');
        inlineNodes(li, item, doc);
        list.appendChild(li);
      }
      frag.appendChild(list);
    } else if (b.type === 'code') {
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = b.text;
      pre.appendChild(code);
      frag.appendChild(pre);
    }
  }
  return frag;
}
