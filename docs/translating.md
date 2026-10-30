# Translating Hexa

Hexa speaks English, German (`de`), French (`fr`), Spanish (`es`) and Japanese (`ja`). This page
covers how to add another language, or fix lines in one she already speaks.

## Which language she uses

`lang` in `~/.config/hexa/config.json` is `"auto"` by default. With `"auto"` she reads your locale
the way gettext does, so she speaks the same language as the rest of your desktop:

1. Your messages locale is the first of `LC_ALL`, `LC_MESSAGES` and `LANG` that is set.
2. If that locale is `C` or `POSIX`, or none of them is set, she speaks English.
3. Otherwise `LANGUAGE` comes first. It's a list like `de:en`, and Plasma's language setting
   writes it. She takes the first language in it that she speaks.
4. If `LANGUAGE` doesn't name one she speaks, she uses the locale: `de_DE.UTF-8` gives `de`.
5. If she doesn't speak that one either, she uses English.

To pick a language yourself, set `"lang": "fr"` (a locale like `"fr_CA"` works too). If she
doesn't speak the language you set, she uses English. The code is in `src/main/lang.js`.

## The files

| File | What's in it |
|---|---|
| `src/renderer/js/lines/xx.js` | Her lines, for a new language `xx`. Copy `en.js` and translate it. |
| `src/renderer/js/lines/index.js` | Import the new table and add it to `TABLES`. |
| `src/main/labels.js` | Her menu (the tray, and the one you get by right-clicking her). Add `TRAY.xx`. |

A language counts once it's in both `TABLES` and `TRAY`, and the tests check that the two lists
match. Anything missing from a table falls back to English, but the tests expect every table to
be complete.

Each line table exports four things:

- `LINES`: what she says, by moment (`done`, `error`, `poke` and so on). Each moment has a list,
  and she picks one line from it at random.
- `VERBS`: the ticker over her head, like `EDITS gigs.ts` or `RUNS npm test`, one per tool.
- `GUIDE`: her first-run guide and the "How does it work?" tour.
- `BUTTONS`: the buttons on her permission card.

## The rules

The tests (`tests/lines.test.mjs`, `tests/tray.test.js`) check most of these. Run `npm test`.

- **Every key English has, and no others.** That covers `LINES`, `VERBS`, `GUIDE`
  (`GUIDE.topics` too), `BUTTONS` and `TRAY`.
- **At least three lines per list.** `online` and `linked` can have just one.
- **Keep placeholders exactly as they are.** You can use `{name}` (the assistant: Claude, Codex…),
  `{project}`, `{n}`, `{time}`, `{files}` and `{user}`. Move them wherever your grammar needs them,
  but don't translate or invent any. A guide string, button or menu label has to keep the same
  placeholders as its English version (`{error}`, `{what}`, `{n}`).
- **Short lines.** They type out one character at a time in a small panel. No line can be wider
  than 1.5 times the longest English line for the same moment. CJK and full-width characters count
  as two columns.
- **Ticker verbs are short and loud.** Ten characters at most, and uppercase in scripts that have
  case. In Japanese, short kanji (`編集`, `実行`) or katakana (`スキル`).
- **She's Hexa, and only Hexa.** She's an original character. Never use the name of the project
  she was ported from (the tests reject "capri" in any script).
- **The guide names her menu items as the menu does.** `GUIDE.folderHow` has to contain the exact
  `hooksRemove` label from `TRAY`.

## Her voice

Translate her voice, not the words. She's a daemon who decided to be seen: sly, curious, a little
smug, fond of you, and proud of her machine. She's short, warm and dry, with a bit of Unix humour
(exit codes, `fork()`, segfaults, zombies, `/dev/null`) that you don't need to know Unix to get.
A joke that doesn't survive translation can go. Put in one that works in your language instead.

What the current tables do:

- **Talk to the user informally.** `du`, `tu`, `tú`. In Japanese she's casual-polite (です/ます
  with light endings) and calls herself わたし.
- **Grammatical gender:** she's feminine (`branchée`, `conectada`).
- **Leave in English what developers say in English:** `exit 0`, `fork()`, `wait()`, segfault,
  hook, prompt, build, logs.
- **Name keys as the user's keyboard does:** `Strg+C` in German, `Alt+Maj+F12` in French,
  `Alt+Mayús+F12` in Spanish.
- **Steer clear of words only one region uses.** Spanish has no `vale` and no `ordenador`.
- **Avoid `{user}` for now.** She doesn't know your name yet, and its fallback is the English
  "there".
- **French typography:** write a plain space before `: ; ! ?`. `fr.js` turns those spaces into
  non-breaking ones, so a lone `!` never wraps onto a line of its own.

## Not translated yet

Some text lives outside these tables and is still English in every language: her consent card
before she uses your computer, the "N actions" status she gives when you click her, the
`WAITING for you` ticker, the stats window, desktop notifications, and her chat replies (those
come from the model). If you move one of them into the tables, add the key to every language.
