// Draw-in animator for `<img class="device traced" src="...svg">` figures.
//
// Every flasher hub tile that was swapped from an inline hand-drawn SVG
// to an <img> pointing at a traced figure lost the classic stroke-
// dashoffset draw-on animation — <img> is opaque to CSS, so path-level
// animations can't reach in.
//
// This script does the swap dynamically:
//   1. On DOMContentLoaded, find every <img class="device traced">.
//   2. Fetch its src (the SVG).
//   3. Replace the <img> with the inline <svg> parsed from that source.
//   4. Walk every <path>, measure it, and animate stroke-dashoffset
//      from its length down to zero with a small per-path stagger
//      spread across a fixed draw window.
//
// The result: on any page that includes this file, every traced device
// figure draws itself in from a blank canvas on load, exactly like the
// inline-SVG flashers already do.
//
// Included from:
//   * /index.html                       (hub grid)
//   * /esp32-s3-devkitc/index.html      (flasher)
//   * /esp32-p4-hub-keylogger/index.html (flasher)
//   * /rubberless-ducky/index.html       (flasher)
(function () {
  'use strict';

  // Total draw window in ms — regardless of how many paths, the animation
  // finishes in about this long. Individual per-path duration is computed
  // so long paths take proportionally more time.
  const DRAW_WINDOW_MS = 1400;
  const START_DELAY_MS = 80;

  function inlineOneTraced(imgEl) {
    const url = imgEl.getAttribute('src');
    if (!url) return;
    fetch(url, { cache: 'force-cache' })
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(svgText => {
        // Parse the SVG source. `image/svg+xml` mode gives us a real
        // Document with a root <svg> we can adopt.
        const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        const svg = doc.documentElement;
        if (!svg || svg.tagName.toLowerCase() !== 'svg') return;

        // Carry over the img's classes/attributes onto the SVG so the
        // page's card/figure sizing rules keep applying.
        svg.setAttribute('class', ((svg.getAttribute('class') || '') + ' ' +
                                   (imgEl.getAttribute('class') || '')).trim());
        // Preserve the alt text as an aria-label for AT users.
        const alt = imgEl.getAttribute('alt');
        if (alt && !svg.getAttribute('aria-label')) svg.setAttribute('aria-label', alt);
        svg.setAttribute('role', 'img');

        // Replace the <img> in-place with the inline <svg>.
        imgEl.replaceWith(svg);
        prepareAndAnimate(svg);
      })
      .catch(() => { /* keep the <img> — better than a blank card */ });
  }

  function prepareAndAnimate(svg) {
    const paths = svg.querySelectorAll('path');
    if (!paths.length) return;

    // Respect prefers-reduced-motion — draw everything solid up front.
    const reduced = window.matchMedia &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // Measure all lengths first (batch reads), then apply styles (batch
    // writes). Two-pass = one layout instead of one per path.
    const info = [];
    let totalLen = 0;
    for (const p of paths) {
      let len = 0;
      try { len = p.getTotalLength(); } catch (_) { continue; }
      if (!len) continue;
      info.push({ el: p, len });
      totalLen += len;
    }
    if (!info.length) return;

    // Set the initial "empty" state on every path in a single tick.
    for (const it of info) {
      it.el.style.strokeDasharray  = it.len;
      it.el.style.strokeDashoffset = it.len;
    }
    // Force a reflow so the "empty" state is committed before we set
    // the transition + trigger it.
    // eslint-disable-next-line no-unused-expressions
    svg.getBoundingClientRect().width;

    // Now assign a transition to each path — duration scales with the
    // path's share of total length so long strokes take more time.
    const n = info.length;
    for (let i = 0; i < n; i++) {
      const it = info[i];
      const share = it.len / totalLen;
      const dur   = Math.min(1200, 220 + share * 4500);
      const delay = START_DELAY_MS + Math.round((i / Math.max(1, n - 1)) * DRAW_WINDOW_MS);
      it.el.style.transition =
        `stroke-dashoffset ${dur}ms cubic-bezier(0.28, 0.11, 0.32, 1) ${delay}ms`;
      // Kick off the animation.
      it.el.style.strokeDashoffset = '0';
    }
  }

  function run() {
    document.querySelectorAll('img.device.traced, img.traced').forEach(inlineOneTraced);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
