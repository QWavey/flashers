# Design system

Written down so the discipline is checkable. **Any value not in this document
is a bug.** A font that is not in the scale, a colour that is not in the
palette, a radius off the scale, a size that falls between steps — none of
those ship.

## Direction

**Instrument panel.** One box on a black field, the way a piece of bench
equipment sits on a bench. The page does not scroll, because a flasher is a
task, not a document: you are here to do four things in order and leave.

Why this and not something else:

- The thing being operated is **hardware**, and hardware pages are lit against
  black. True `#000` is not a default reached for here, it is the convention
  for showing a physical object.
- The content is genuinely **numeric and technical** — hex addresses, USB
  vendor/product IDs, byte counts, page counts. That earns a monospace face for
  data. It is not decoration; those strings really are code.
- One accent, and it only ever means **here, now**. Orange is the current step,
  the page being written, and the warning. It is deliberately *not* the colour
  of finished work: written pages are white, so the accent never accumulates
  and always points at one thing. Nothing decorative is orange.
- The favicon was kept, so the accent is drawn from it (`#b23f0d` lifted for a
  black background) and the identity stays coherent.
- The `·` in the wordmark is a **neutral** separator (`--gray-2`), not an accent.
  A coloured dot in a wordmark is decoration, and orange is reserved for state.

## Colour

Every literal. Contrast measured against `#000000`.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--black` | `#000000` | page | — |
| `--surface-1` | `#0A0A0B` | the box | — |
| `--surface-2` | `#101013` | left slab, drawers | — |
| `--surface-3` | `#17171B` | wells: `code` | — |
| `--line-1` | `#1F1F23` | hairline at rest | — |
| `--line-2` | `#34343B` | hairline on hover/focus | — |
| `--white` | `#F5F5F7` | primary text, written pages, completed steps | 19.3:1 |
| `--gray-1` | `#A1A1A6` | secondary prose | 8.1:1 |
| `--gray-2` | `#8A8A8F` | meta, labels, figure annotation | 6.1:1 |
| `--accent` | `#FF6A13` | here-now: current step, page in flight, warning | 7.3:1 |
| `--ok` | `#30D158` | success | 10.4:1 |
| `--err` | `#FF453A` | failure | 6.2:1 |

Text is never `#FFFFFF`: pure white halates against true black. `#F5F5F7` reads
as white and stays comfortable.

**There is no grey below `--gray-2` for text.** `#6E6E73` (4.1:1) and `#5A5A60`
(2.6:1) were in an earlier pass and were removed — both fail AA at body size.
If something needs to recede further, it recedes by size or position, never by
going dimmer.

## Type

Two faces, each with a job.

- **Archivo** — display and UI. A grotesque with more grip than Inter, which
  suits a tool rather than a landing page.
- **IBM Plex Mono** — every value that is literally a value: addresses, IDs,
  byte counts, the log, the figure's annotation, status.

| Step | Size / weight / tracking | Use |
|---|---|---|
| view heading | `clamp(30px, 3.4vw, 42px)` / 700 / −0.03em | the one thing per step |
| readout | 19px / 600, tabular | bytes written |
| body | 15px / 400 / 0, line-height 1.6 | step prose |
| slab + list | 13–14px | specs, files |
| mono data | 13px / 500 | values, log |
| label | 12px / 500 / 0.1em, uppercase | kicker, status, rail, drawer heads |

Nothing below 12px. Prose is capped at 54ch, the legal line at 74ch.

**The figure's labels are sized for the scale they land at, not the size they
are declared at.** The SVG is scaled down to fit the slab, so an 11px label
rendered at 8px. The figure is capped at 300px tall so it supports the wizard
rather than competing with it, which puts the scale near 0.52 — the labels are
therefore 23px/20px in viewBox units, landing at 12px and 10.4px on screen.
Resizing the figure means re-measuring them, and re-checking that the
end-anchored labels on the left still fit inside the viewBox.

**Uppercase tracked labels are only used where the label names a field**
(`IMAGE`, `EXTENT`, `MCU`, status, rail steps, drawer heads). They are never
stacked above a heading as an eyebrow. `STEP 01 OF 04` is wizard state, not
editorial numbering.

## Shape

`--r-1: 3px` (code, pips) · `--r-cell: 5px` (page-map cells) ·
`--r-2: 8px` (controls, rows) · `--r-3: 16px` (the box).

Separation is **one hairline** (`--line-1`) or a background-tone step, never
both plus a shadow. There are no drop shadows anywhere. There is no accent
border down one side of anything.

## Space

`4 · 8 · 12 · 16 · 24 · 32 · 48`

Controls use 8–16, panels 16–24, view padding 32. A `max-height: 700px` media
query steps the whole thing denser rather than switching layout.

## The progress readout

A bar was the first attempt and it was wrong: a thin rounded track that fills is
the single most generic progress element there is, and it also threw away the
one thing worth knowing.

What ships instead is a **page map** — one cell per 512-byte page, because that
is exactly what the write does. It carries information a bar cannot:

- how far it got, in the unit the device actually works in;
- **where it stopped**, marked in red on the page that failed;
- an outlined **write head** on the page currently going out;
- an indeterminate sweep during chip erase, which genuinely reports no position.

Cells are 17px with a 5px radius and fill **white**, not orange: white is
written data, orange stays reserved for the one page in flight. Green sweeps
the map in write order on success.

The step rail is a **single continuous line** with the pips sitting on it, not
segments butting into each pip. Each step draws the track from its own pip's
centre to the next one's (`left: 8px; right: -8px`), which lands flush across
the column boundary without measuring anything; the pips are opaque and stacked
above, so the line passes behind them, not through them. Labels sit under the
pips, because one unbroken line cannot also run through text.

Every pip is the same clockwise dial driven by `--fill` (a registered
`<number>`, so it sweeps rather than snaps). The current pip shows overall
progress — Brief 1/4, DFU 2/4, Connect 3/4, Flash 4/4 — and a step already
behind you is full. There is **no orange on the pips**: the ring is neutral and
fill is white, so the dial reads as one arc rather than a ringed blob. The
current *step label* stays orange, which is the one legitimate "here, now" use.

The pip fills **after** the line reaches it. On a step change the connector runs
first (520 ms, no delay) and the pip's `--fill` is delayed by that same 520 ms,
so the line visibly arrives at the circle and *then* the circle fills. Measured:
the line is at 99% while the pip is still empty, and the pip only begins once the
line hits 100%.

Above 96 pages one cell stands for several so a 256 KB image still fits; the
page counts beside it stay true either way.

## Motion

```
--e-out:   cubic-bezier(0.22, 0.61, 0.36, 1)
--e-apple: cubic-bezier(0.28, 0.11, 0.32, 1)
--d-1: 160ms   --d-2: 300ms   --d-3: 520ms   --d-4: 820ms
```

**No curve overshoots.** No bounce, no elastic, no spring. Motion settles.

| Motion | Reason |
|---|---|
| Box fades and lifts 14px on load | one arrival, then stillness |
| Figure strokes itself on, per shape | the drawing draws, like a plotter |
| Views cross-slide 18px | direction of travel through the wizard |
| Page-map cell scales in as it fills | you can see the page land |
| Green sweeps the map in write order on success | the whole image, in order |
| Rail connector fills left to right | steps completing |
| Hold-to-flash fill | the confirmation itself, see below |
| Drawers slide up over the box | they cover, they do not resize |
| Buttons scale to 0.972 while pressed | the control gives under the finger |

What deliberately does **not** move: the status dot does not pulse, nothing
scales on hover, there is no marquee, no fake caret.

**Nothing on the critical path depends on an animation actually running.** A tab
that is not compositing never runs `requestAnimationFrame`, and a throttled or
disabled animation never leaves its first keyframe. That bit the figure's
draw-on, then hold-to-flash, then the page-map cells — which used
`animation-fill-mode: both` and so sat pinned at `scale(0.55)` whenever the
animation had not run. The rules that came out of it: gate actions on timers
and CSS transitions, never rAF; and never let a resting state live in a
keyframe, so a cell that never animates is simply full size.

`prefers-reduced-motion: reduce` collapses every duration and delay and forces
the figure to its finished state. Nothing is left hidden.

## Hold to flash

The write cannot be undone and there is no way back to stock firmware, so it
takes a 700 ms press-and-hold rather than a click a stray tap could trigger.
The fill *is* the confirmation — there is no separate dialog. Keyboard gets the
same gate by holding Enter or Space.

## Craft floor

Measured by the audit in the improve run, not asserted:

- Contrast ≥ 4.5:1 for all text, ≥ 3:1 for large. **0 failures.**
- Nothing under 12px. **0 failures.**
- Prose measure under 85 characters. **0 failures.**
- Touch targets ≥ 24px. **0 failures.**
- No page scroll, no box scroll, no view overflow, at every size from 390×844
  to 1280×900. Below ~700px tall the panel scrolls internally by design.
- Nothing outside the figure's viewBox; nothing invisible at rest.

## Two traps worth remembering

**Cascade.** `.view p` is `(0,1,1)` and beats a bare `(0,1,0)` class on a
paragraph. Class rules on non-prose paragraphs inside a view are therefore
scoped (`.view .kicker`, `.view .readout`, `.view .inline-err`). Adding a new
styled `<p class="…">` inside `.view` means scoping it too, or `.view p`
silently wins — it already cost the gauge its font size once.

**Overflow.** The box uses `overflow: clip`, not `hidden`. A closed drawer sits
at `translateY(100%)`, and a transformed child still contributes scrollable
overflow, so `hidden` made the box a scroll container that a `focus()` could
shove out of alignment. And the box's height comes from flex, not from
`100svh - <a number>`: the moment the legal line wrapped, the magic number was
wrong and the page started scrolling.
