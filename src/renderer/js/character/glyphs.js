// Her visor shows her eyes as an LED dot matrix: each glyph is two 5×5 grids (left eye, right
// eye), rows of '.' (off) and '#' (lit). The glyphs themselves live in the character's pack.

export const GLYPH_NAMES = ['calm', 'smug', 'wide', 'laugh', 'squint', 'sleepy', 'angry', 'dizzy', 'heart', 'loading', 'ask', 'dead'];

export function isGlyph(eyes) {
  return Array.isArray(eyes) && eyes.length === 2
    && eyes.every((rows) => Array.isArray(rows) && rows.length === 5 && rows.every((row) => typeof row === 'string' && /^[.#]{5}$/.test(row)));
}
