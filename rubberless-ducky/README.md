# Rubberless-Ducky WebFlasher

WebUSB / AVR32 DFU flasher for the
[Rubberless-Ducky](https://github.com/QWavey/Rubberless-Ducky) open
firmware — targets the Hak5 USB Rubber Ducky Mk II (2022 board).

**Live:** https://qwavey.github.io/flashers/rubberless-ducky/
**Firmware source:** https://github.com/QWavey/Rubberless-Ducky
**Hub:** https://qwavey.github.io/flashers/ *(also in this repo, one level up)*
**Legacy URL:** `qwavey.github.io/WebFlasher/` still resolves — same content — kept alive until that source repo is archived.

## Layout

```
index.html            single-screen wizard, references css/js separately
css/style.css         all styling; the design system is documented in DESIGN.md
js/flasher.js         Atmel AVR32 DFU flasher over WebUSB, plus the wizard
assets/favicon.svg    split-duck favicon (the joke)
assets/device.svg     standalone copy of the board drawing (kept in sync by hand)
firmware.hex          bundled prebuilt image
DESIGN.md             the design system, and the rule that anything outside it is a bug
```

## Runs how

`js/flasher.js` implements the Atmel DFU protocol subset used by
`dfu-programmer` for AT32UC3B parts: chip erase, region + base-page select,
page-by-page program with a 6-byte header, launch. Intel-HEX parsing is inline.

The UI is a four-step wizard inside one box sized to the viewport. The page
itself never scrolls; views cross-fade in place and the Files and Log panels
slide up over the box rather than resizing it. No framework.

Progress is a **page map** rather than a bar: one cell per 512-byte page, so it
shows how far the write got, which page it stopped on if it failed, and which
page is going out right now. Chip erase has no position to report, so the map
sweeps instead of pretending to one.

The figure in the left slab is drawn from a NEW DUC v2.0 board, component side:
USB-C at one end, USB-A at the other, the microSD socket, the X1 crystal, SW1
and the eight-pad header. The microcontroller is on the reverse, so it is drawn
dashed in the hidden-line convention rather than invented onto the side you can
see.

Flashing is gated behind a 700 ms press-and-hold, because the write cannot be
undone.

## Safety checks

The flasher refuses an image before it writes anything if:

- any Intel-HEX record fails its checksum, is malformed, or the file has no
  end-of-file record;
- the base address falls outside the 256 KB flash window at `0x80000000`;
- the image reaches into the first 8 KB, which is the DFU bootloader — writing
  there removes the only way back onto the part;
- the image runs past the end of flash.

A device unplugged mid-write is reported as an incomplete image rather than
silently leaving the wizard in a success state.

## Editing

The three files are separate so any of them can be edited without touching the
others:

- **Structure** in `index.html`
- **Look** in `css/style.css` — read `DESIGN.md` first; the tokens are all at
  the top of `:root`, and values outside the documented system do not ship
- **Behavior** in `js/flasher.js` (protocol constants near the top)

## Known unknown

`selectRegion()` sends `06 03 <region>` and `setBasePage()` sends
`06 03 <hi> <lo>`. `dfu-programmer`'s `src/atmel.c` appears to use a 4-byte
select-memory-unit (`06 03 00 <unit>`) and, for AVR32 parts, a 5-byte
select-page (`06 03 01 <hi> <lo>`). These bytes have **not** been changed,
because there is no AT32UC3B here to test against and a wrong guess writes to
the wrong page. Worth verifying against `atmel.c` and real hardware before the
alpha label comes off.

## Legal

Clean-room reimplementation. No Hak5 code, firmware, or artwork is distributed
here. See the full note in the
[main repo README](https://github.com/QWavey/Rubberless-Ducky#legal).
