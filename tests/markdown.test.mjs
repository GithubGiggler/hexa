import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, renderBlocks } from '../src/renderer/js/markdown.js';

test('inline: strong, code, emphasis and links', () => {
  assert.deepEqual(parseMarkdown('I added **GET /gigs** with `cursor`')[0].inline.map((n) => n.type), ['text', 'strong', 'text', 'code']);
  const [p] = parseMarkdown('see *this* and [the docs](https://example.com/x)');
  assert.deepEqual(p.inline, [
    { type: 'text', text: 'see ' }, { type: 'em', text: 'this' }, { type: 'text', text: ' and ' }, { type: 'link', text: 'the docs' },
  ]);
});

test('blocks: lists, numbered lists, fenced code, paragraphs', () => {
  assert.equal(parseMarkdown('- a\n- b')[0].type, 'ul');
  assert.equal(parseMarkdown('- a\n- b')[0].items.length, 2);
  assert.equal(parseMarkdown('1. one\n2. two')[0].type, 'ol');
  const code = parseMarkdown('```js\nnpm test\nnpm run lint\n```')[0];
  assert.deepEqual(code, { type: 'code', text: 'npm test\nnpm run lint' });
  assert.equal(parseMarkdown('first\n\nsecond').length, 2);
  assert.equal(parseMarkdown('## Done')[0].inline[0].type, 'strong');
});

test('markup stays literal text', () => {
  const evil = parseMarkdown('<img src=x onerror=alert(1)>')[0].inline;
  assert.deepEqual(evil, [{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);
});

// a document that only knows the safe calls: any innerHTML use would throw
function fakeDoc() {
  const made = [];
  const node = (tag) => {
    const n = {
      tag, children: [], text: '',
      appendChild(c) { this.children.push(c); return c; },
      set textContent(v) { this.text = String(v); },
      get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); },
      set innerHTML(_) { throw new Error('innerHTML used'); },
      setAttribute() {}, className: '',
    };
    made.push(n);
    return n;
  };
  return {
    made,
    createElement: (tag) => node(tag),
    createTextNode: (text) => ({ tag: '#text', textContent: String(text) }),
    createDocumentFragment: () => node('#fragment'),
  };
}

test('renderBlocks builds elements and text nodes only', () => {
  const doc = fakeDoc();
  const frag = renderBlocks(parseMarkdown('Hi **there**\n\n- `a`\n- <b>b</b>\n\n```\nx\n```'), doc);
  assert.equal(frag.tag, '#fragment');
  assert.deepEqual(doc.made.map((n) => n.tag).filter((t) => t !== '#fragment'), ['p', 'strong', 'ul', 'li', 'code', 'li', 'pre', 'code']);
  assert.ok(frag.textContent.includes('<b>b</b>'), 'tags shown as text');
  assert.ok(!doc.made.some((n) => n.tag === 'b' || n.tag === 'img' || n.tag === 'a'));
});
