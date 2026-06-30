# Teenage Engineering–influenced design guidelines

Reference for any project in this repo borrowing TE's visual language (currently applied to
1001-albums' Today page, scoped under `.te-today`). Grounded in real TE source material, not
vibes — see Sources at the bottom.

## Core principles

1. **Color is meaning, not decoration.** TE doesn't standardize on orange as a brand mandate —
   their product lines use whatever single accent suits that device (the PO series ships in many
   different colorways; Field radios, the TP-7, and the OP-1 family each pick their own). What's
   consistent is the *discipline*: one accent, applied only to elements that carry a specific
   meaning (record buttons, the one knob you must touch), never as generic page furniture. Pick
   whatever accent color fits your project's own theme — in 1001-albums that happens to be the
   orange from the existing Lanky Kong theme, which is incidental to this app, not a rule to carry
   into other projects. Whatever color you pick, don't reuse it for two unrelated purposes (e.g.
   "this tab is active" and "this is a section header") — if the same color marks two different
   kinds of thing, neither reads clearly anymore.

2. **Numbers must be honest.** Only use sequential digits (01, 02, 03...) where the number maps
   to something real and fixed — a physical button position, a switch state, an actual selection
   index. A row of tabs where `01/02/03` corresponds to "first tab, second tab, third tab" is
   honest. Prefixing arbitrary content section headers with the same numbering is not — it
   implies order/count where none exists, and it's confusing precisely because it visually
   duplicates the tab convention for an unrelated purpose.

3. **Label categories with a fixed-format badge, not a sequence.** TE's own quick-start guides
   mark persistent function categories with a small filled badge/glyph plus a short mnemonic code
   or abbreviated word (`bpm`, `write`, `sound`, `FX`) — never "01 BPM, 02 WRITE." The badge shape
   stays constant across all instances; only the code/word inside changes. Differentiation comes
   from the mnemonic, not a position number, so reordering or adding sections never breaks the
   meaning.

4. **Typography: uppercase labels, lowercase body.** Section/control labels are monospace,
   uppercase, tightly tracked, and small. Descriptive body copy stays lowercase and a clear size
   step larger than the label. Numbers when used are neutral weight — never bolded for false
   emphasis.

5. **Scarcity makes color legible.** Any individual TE product's palette is deliberately tiny —
   one accent for that device + black + white/aluminum + occasionally a screen-green. Color reads
   as meaningful specifically because it's rare within that product. Adding a second or third
   accent color to one design dilutes this — resist it even when a design feels like it "needs
   more punch." (The fix for "needs more punch" is usually a bolder application of the one accent
   you already have — a filled badge instead of a thin rule — not a second color.)

## Concrete CSS pattern: category badges

Use a small fixed-shape badge (filled accent background, short mnemonic code, monospace) before
a section label — not a number:

```css
.section-label {
  display: flex; align-items: center; gap: 6px;
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; font-weight: 600;
}
.section-label::before {
  content: attr(data-badge);
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 14px; padding: 0 3px;
  background: var(--accent); color: #fff;
  font-size: 9px; font-weight: 700; letter-spacing: 0;
  border-radius: 2px;
}
```

Markup supplies the mnemonic per instance (derived from the label, not a count):

```html
<div class="section-label" data-badge="GS">Genres &amp; Styles</div>
<div class="section-label" data-badge="LO">Listen On</div>
<div class="section-label" data-badge="CM">How We Compare</div>
<div class="section-label" data-badge="DL">Discovery Links</div>
```

Where digits genuinely represent position (a tab switch, a numbered control), the earlier pattern
still applies — a plain `::before { content: counter(...) }` prefix is fine there, since the
number is true.

## What to avoid

- Corner registration marks (`+`) or other pure ornament with no informational role — TE's marks
  on real hardware/manuals always indicate something (an alignment point for assembly, a screw
  location); decorative versions with no referent read as noise, not flavor.
- Sequential numbering on anything that isn't an actual sequence or selection.
- More than one accent color in a single scoped skin.
- Reusing one visual device (numbering, a specific badge shape) for two semantically different
  purposes in the same view.

## Sources

Compiled by research agent from primary TE material and design retrospectives:

- [Pocket Operator Quick Start Guide (PDF)](https://teenage.engineering/_img/600072210dfb800004f24df9_original.pdf) — primary source for the badge+mnemonic labeling convention.
- [blakecrosley.com — TE design system breakdown](https://blakecrosley.com/guides/design/teenage-engineering)
- [Field Series interview, notes.catalog.works](https://notes.catalog.works/posts/teenage-engineering-field-series-interview)
- [SFMOMA interview with Jesper Kouthoofd](https://www.sfmoma.org/read/stay-curious-stay-naive-an-interview-with-teenage-engineering-jesper-kouthoofd/)
- [OP-Z interface overview guide](https://teenage.engineering/guides/op-z/interface-overview)
