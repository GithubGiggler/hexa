'use strict';

// Text that came from outside (the CLI, Claude's events, a music player) made safe to show: no
// control characters, no bidi overrides that could make it read as something else, and a length cap.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

// Cuts text to max characters without leaving half of a surrogate pair (emoji, rare scripts).
function cut(text, max) {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end) + '…';
}

// One line (tabs and newlines become spaces), or several with lines: true. Non-strings give ''.
function clean(value, max, { lines = false } = {}) {
  if (typeof value !== 'string') return '';
  let text = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROL, '').replace(BIDI, '');
  text = lines
    ? text.split('\n').map((l) => l.replace(/ {2,}/g, ' ').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ');
  return cut(text.trim(), max);
}

module.exports = { cut, clean };
