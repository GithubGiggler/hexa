# Character packs

Hexa is drawn in code from a **character pack**: one JSON file that describes her skeleton, the
shapes on it, her hair and cable, her colours and her visor's expressions. How she moves (the
animations) lives in the code, not in the pack. The pack says which bone each movement turns.

The pack that ships is `packs/hexa/pack.json`. Its format is described by
`packs/pack.schema.json` (JSON Schema) and checked when she loads it, by
`src/renderer/js/character/pack.js`. A pack that fails the check isn't drawn: she falls back to
Hexa.

**The original-character rule.** Every pack in this repo is an original character. Never add,
trace or imitate the Capri character from capri-desktop, or any other character you don't own.
Only Hexa ships.

## The file

```json
{
  "id": "hexa",
  "name": "Hexa",
  "version": 1,
  "height": 248,
  "palette": { "navy": "#141a2e", "cyan": "#3ef2ff", "...": "..." },
  "bones": [ ... ],
  "parts": [ ... ],
  "chains": [ ... ],
  "glyphs": { "calm": [ ... ], "...": [ ... ] }
}
```

| Field | Required | What it is |
|---|---|---|
| `id` | yes | A non-empty string. |
| `name` | yes | Her name, for people. |
| `version` | yes | Always `1`. |
| `height` | yes | Her design height in pixels at size Medium. Checked, but not used yet. |
| `palette` | yes | Colour names to `#rrggbb`. |
| `bones` | yes | Her skeleton. |
| `parts` | yes | The shapes drawn on the bones. |
| `chains` | no | Hair strands and the cable: strings of points that follow physics. |
| `glyphs` | yes | Her visor's expressions. |

**Coordinates** are design pixels at size Medium (1). `y` grows downward, so up is negative. Each
bone's position is relative to its parent bone, and each part's path and each chain's anchor are in
their bone's space. Angles are in radians, clockwise on screen; a bone's angle 0 points the way it
is drawn (limbs hang down).

## Bones

```json
{ "id": "upperR", "parent": "spine", "x": 22, "y": -34, "len": 30, "pose": "armR", "sign": -1 }
```

| Field | What it does |
|---|---|
| `id` | The bone's name. |
| `parent` | Its parent bone, or `null` for the first bone. |
| `x`, `y` | Where it joins its parent, in the parent's space. |
| `len` | Its length. For you: the code doesn't need it. |
| `pose` | The pose field that turns it (see below). |
| `sign` | `-1` mirrors that pose field, for the right side, so `armR: 0.5` raises the right arm outward just as `armL: 0.5` raises the left. |
| `stretch` | A pose field that scales the bone along its length (her pointing arm uses `longL` and `longR`). Its children keep their own size. |
| `fold` | `true`: foreshortened by the `fold` pose field, for thighs folding toward you when she sits. |

The bones are listed parents first. The first bone is the root (`"parent": null`): it sits where she
stands, at her feet. Moving, facing left or right, bobbing, leaning (`tilt`) and squash and stretch
(`sx`, `sy`) apply to the root, and so to everything.

Hexa's skeleton is `root`, `hips`, `spine`, `neck`, `head`, then `upperL`, `foreL`, `handL`,
`upperR`, `foreR`, `handR`, `thighL`, `shinL`, `footL`, `thighR`, `shinR` and `footR`.

**Bones the code looks for by name.** The checks don't require these, but her behaviour uses them:

| Bone | Used for |
|---|---|
| `head` | Where she looks from, and where the pointer wakes her or makes her shy. |
| `neck` | The shoulder her pointing starts from. |
| `upperL`, `upperR` | The arm that turns to point at a window. |
| `handL`, `handR` | Where her sparks, her zap and her pointing wire come from. |

Without them she still draws, but those things start from the middle of her body.

### Pose fields

The animations set these fields, frame by frame. A bone follows a field when its `pose` or
`stretch` names it.

| Field | What it is |
|---|---|
| `head` | Head tilt, radians. |
| `armL`, `armR` | Upper arms, radians. Positive raises them outward. |
| `elbowL`, `elbowR` | Forearms, radians. Negative folds them in across her. |
| `longL`, `longR` | Forearm drawn longer than it is (1 is as drawn), for reaching. |
| `kickL`, `kickR` | Lower legs swinging outward. |
| `fold` | Thighs toward you, 0 to 1 (sitting). Used by bones with `"fold": true`. |
| `tilt` | Whole-body lean, degrees (root). |
| `bob` | Up and down, pixels, negative is up (root). |
| `sx`, `sy` | Squash and stretch (root). |
| `hair` | Hair sway, pixels (chains). |
| `bristle` | Hair lift: positive stands it up (chains, all but the one named `cable`). |
| `visor` | A glyph name: the expression on her visor. |

`smear`, `echo` and `cable` also exist in the animation sheets (`src/renderer/js/character/acting.js`,
`NEUTRAL`).

## Parts

A part is one shape, drawn on one bone.

```json
{ "id": "head", "bone": "head", "path": "M -38 -34 C -38 -57 -21 -71 0 -71 C 21 -71 38 -57 38 -34 Z",
  "fill": "skin", "stroke": "navyLight", "width": 1.2, "z": 6 }
```

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Unique among parts and chains. |
| `bone` | yes | The bone it's drawn on. |
| `path` | yes | SVG path data in the bone's space. Absolute `M`, `L`, `C`, `Q` and `Z` only (no lowercase, no `H`, `V`, `A`, `S`, `T`). Extra pairs after `M` are lines, as in SVG. |
| `fill` | `fill` or `stroke` | A palette name, `"emblem"` (her state colour) or `"none"`. |
| `stroke` | `fill` or `stroke` | A palette name. |
| `width` | no | The stroke's width. 1 by default. |
| `z` | yes | Draw order, back to front. Parts and chains share it. |
| `role` | no | A part the code draws something extra on (below). |

| Role | What's drawn |
|---|---|
| `visor` | Her eyes: the current glyph in `amber`, in the rectangle x −33 to 33, y −42.5 to −25.5 of its bone's space. Put it on a bone where that rectangle falls on the visor (Hexa's is on `head`). |
| `emblem` | Filled with her state colour, and glowing (cyan, amber, magenta, red, green). |
| `earL`, `earR` | The link light, a small `cyan` dot in the middle of the part, which blinks on every Claude action. |
| `mouth` | Allowed, but nothing extra is drawn yet. |

Lines are redrawn slightly differently on each drawing (a small "boil", like hand-drawn animation).

**Her click area** comes from the parts: each part's box (control points included), padded by 4
pixels, merged where boxes overlap, at most 12 rectangles. Every click inside them goes to her, so
keep stray control points close to the shape.

## Chains

A chain is a string of points hanging from a bone, moved by simple physics: her hair strands and
her cable.

```json
{ "id": "hairF1", "bone": "head", "x": -41, "y": -42, "angle": 0.05, "segments": 4, "length": 11,
  "width": [8, 3], "color": "cyan", "tip": "white", "z": 8.5, "stiffness": 0.35, "damping": 0.9 }
```

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Unique among parts and chains. A chain named `cable` doesn't bristle. |
| `bone` | yes | The bone it hangs from. |
| `x`, `y` | yes | Where it hangs from, in the bone's space. |
| `angle` | no | Its rest direction relative to the bone, radians. 0 hangs straight down. |
| `segments` | yes | 1 to 12. |
| `length` | yes | Each segment's length. |
| `width` | yes | `[base, tip]`: the line's width at the root and at the end. |
| `color` | yes | A palette name. |
| `tip` | no | A palette name: a glowing dot at the end. |
| `plug` | no | `true`: a plug at the end instead of a dot (her cable). |
| `z` | yes | Draw order, shared with parts. |
| `stiffness` | no | How strongly it springs back to its rest shape, 0 to 1. 0.3 by default. |
| `damping` | no | How much of its motion it keeps from one step to the next. 0.9 by default; lower settles faster. |

Each point keeps exactly one segment length from the one before, so a chain can't stretch or fly
apart, however long a frame takes.

## Palette

Any names you like, each `#rrggbb`. Parts and chains refer to them by name.

The code also uses some names directly, so a pack needs these:

| Name | Used for |
|---|---|
| `cyan` | Her idle emblem, the link light, sparks, effects, the pointing wire. |
| `amber` | Her visor's eyes, the thinking emblem. |
| `magenta` | Waiting for you, alerts. |
| `red` | Errors. |
| `green` | Done. |
| `white` | Effects. |
| `navy` | Her core. |
| `navy2` | Effects. |
| `visor` | The visor behind her eyes, on her core and her cards. |

The check doesn't require them yet: a pack without them draws those bits in no colour.

## Glyphs

Her visor shows her eyes as a dot matrix: each glyph is two 5×5 grids, the left eye and the right
eye, as rows of `.` (off) and `#` (lit).

```json
"calm": [
  [".###.", "#####", "#####", "#####", ".###."],
  [".###.", "#####", "#####", "#####", ".###."]
]
```

These 12 are required: `calm`, `smug`, `wide`, `laugh`, `squint`, `sleepy`, `angry`, `dizzy`,
`heart`, `loading`, `ask` and `dead`. You can add more under any name. `hexa say --face <name>` can
show them (an unknown name shows `calm`).

The code uses some on its own: `wide` and `sleepy` on her core in the background, `laugh` across a
window she possesses, `loading` for a beat between two faces on her cards, and `calm` as the
fallback.

## Making one

1. **Start from Hexa.** Copy `packs/hexa/pack.json` to `packs/<your-id>/pack.json` in a checkout
   and change `id` and `name`.
2. **Keep her proportions at first.** Her behaviour assumes a character about 110 by 250 pixels at
   size Medium, standing on the root, with hips 66 pixels above it when seated, and the visor
   around (0, −34) in the head's space. Very different proportions will sit oddly on window edges,
   lurk at the wrong height, or take clicks in the wrong places.
3. **Check it:**

   ```sh
   node --input-type=module -e "import fs from 'node:fs'; import { validatePack } from './src/renderer/js/character/pack.js'; const r = validatePack(JSON.parse(fs.readFileSync(process.argv[1], 'utf8'))); console.log(r.ok ? 'OK' : r.errors.join('\n'))" packs/<your-id>/pack.json
   ```

   It prints `OK`, or each problem: an unknown bone or colour, a parent listed after its child, a
   path command it doesn't take, a missing glyph.
4. **Look at it.** `src/renderer/dev/rig.html` is a contact sheet of the pack in her key poses,
   with every glyph and her core. It loads `packs/hexa/pack.json`: change that URL to yours. Then
   render it to a PNG (this starts Electron, off screen):

   ```sh
   npx electron tools/capture.js src/renderer/dev/rig.html captures/rig.png
   ```

5. **Load it.** In 0.1.0 there is no setting to pick a pack: she always loads
   `hexa://app/packs/hexa/pack.json` (`packUrl` in `rendererConfig`, `src/main/main.js`). To try
   yours from a checkout, point that at `hexa://app/packs/<your-id>/pack.json`, or put your pack in
   `~/.local/share/hexa/packs/<your-id>/` and use `hexa://packs/<your-id>/pack.json`. If the pack
   fails its check, she draws Hexa instead, and with `npm run dev` the reasons are in her log.

Pack files are served through her `hexa://` protocol: `hexa://app/` for the app's own folder and
`hexa://packs/` for `~/.local/share/hexa/packs/`. Nothing outside those folders can be reached.
