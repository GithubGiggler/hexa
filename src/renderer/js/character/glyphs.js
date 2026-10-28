// Her visor shows her eyes as an LED dot matrix: each glyph is two 5×5 grids (left eye, right
// eye), rows of '.' (off) and '#' (lit). The glyphs themselves live in the character's pack.

export const GLYPH_NAMES = ['calm', 'smug', 'wide', 'laugh', 'squint', 'sleepy', 'angry', 'dizzy', 'heart', 'loading', 'ask', 'dead'];

// Draws both eyes inside rect [x, y, w, h]: the left eye in its left half, the right in its right.
// Lit dots glow; unlit ones stay faintly visible, like a real LED matrix.
export function drawGlyph(ctx, eyes, [x, y, w, h], color, { lit = 1 } = {}) {
  const half = w / 2;
  const pitch = Math.min(half, h) / 5;
  const r = pitch * 0.38;
  ctx.save();
  ctx.fillStyle = color;
  eyes.forEach((rows, eye) => {
    const ox = x + eye * half + (half - pitch * 5) / 2;
    const oy = y + (h - pitch * 5) / 2;
    rows.forEach((row, ry) => {
      for (let cx = 0; cx < 5; cx++) {
        const on = row[cx] === '#';
        ctx.globalAlpha = on ? lit : 0.1;
        ctx.shadowColor = color;
        ctx.shadowBlur = on ? pitch * 1.2 : 0;
        ctx.beginPath();
        ctx.arc(ox + (cx + 0.5) * pitch, oy + (ry + 0.5) * pitch, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });
  ctx.restore();
}

export function isGlyph(eyes) {
  return Array.isArray(eyes) && eyes.length === 2
    && eyes.every((rows) => Array.isArray(rows) && rows.length === 5 && rows.every((row) => typeof row === 'string' && /^[.#]{5}$/.test(row)));
}
