import test from 'node:test';
import assert from 'node:assert/strict';
import { placePanel } from '../src/renderer/js/panel.js';

const area = { x: 0, y: 0, w: 2560, h: 1440 };
const size = { w: 420, h: 160 };

test('the panel stays on screen wherever she is', () => {
  for (const anchor of [[0, 0, 100, 200], [2460, 0, 100, 200], [0, 1240, 100, 200], [2460, 1240, 100, 200], [1200, 600, 100, 200]]) {
    const p = placePanel(anchor, size, area);
    assert.ok(p.x >= area.x && p.y >= area.y && p.x + size.w <= area.x + area.w && p.y + size.h <= area.y + area.h, JSON.stringify(anchor));
  }
});

test('it goes above her when there is room, and does not cover her', () => {
  const anchor = [1200, 600, 100, 200];
  const p = placePanel(anchor, size, area);
  assert.ok(p.y + size.h <= anchor[1]);
});

test('with no room above, it sits beside her, not on her', () => {
  const anchor = [2300, 10, 100, 200];
  const p = placePanel(anchor, size, area);
  const overlaps = p.x < anchor[0] + anchor[2] && anchor[0] < p.x + size.w && p.y < anchor[1] + anchor[3] && anchor[1] < p.y + size.h;
  assert.equal(overlaps, false);
});
