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

  // Two-phase pipeline:
  //   Phase 1 (immediate, at DOMContentLoaded): replace every <img>
  //     with inline <svg> and put every path into its "empty" state
  //     (stroke-dashoffset == length). This means every tile is
  //     invisible until it's told to draw — which prevents the
  //     "the card already drew itself while you weren't looking"
  //     problem the horizontal-filmstrip hub had.
  //
  //   Phase 2 (per-tile, when it enters the viewport):
  //     IntersectionObserver fires → we assign transitions and set
  //     stroke-dashoffset to 0. The paths animate in front of the
  //     user rather than three viewport-widths off to the right.
  const drawnSet = new WeakSet();

  function inlineOneTraced(imgEl) {
    const url = imgEl.getAttribute('src');
    if (!url) return;
    fetch(url)
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(svgText => {
        const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        const svg = doc.documentElement;
        if (!svg || svg.tagName.toLowerCase() !== 'svg') return;

        svg.setAttribute('class', ((svg.getAttribute('class') || '') + ' ' +
                                   (imgEl.getAttribute('class') || '')).trim());
        const alt = imgEl.getAttribute('alt');
        if (alt && !svg.getAttribute('aria-label')) svg.setAttribute('aria-label', alt);
        svg.setAttribute('role', 'img');

        imgEl.replaceWith(svg);
        prepareEmpty(svg);          // Phase 1: hide all paths
        observeForDraw(svg);        // Phase 2: draw when visible
      })
      .catch(() => { /* keep the <img> — better than a blank card */ });
  }

  function prepareEmpty(svg) {
    // Respect prefers-reduced-motion — leave everything solid up front.
    const reduced = window.matchMedia &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { drawnSet.add(svg); return; }

    const paths = svg.querySelectorAll('path');
    const info = [];
    let totalLen = 0;
    for (const p of paths) {
      let len = 0;
      try { len = p.getTotalLength(); } catch (_) { continue; }
      if (!len) continue;
      p.style.strokeDasharray  = len;
      p.style.strokeDashoffset = len;
      info.push({ el: p, len });
      totalLen += len;
    }
    svg.__drawInfo = { info, totalLen };
  }

  function animate(svg) {
    if (drawnSet.has(svg)) return;
    drawnSet.add(svg);
    const bundle = svg.__drawInfo;
    if (!bundle) return;
    const { info, totalLen } = bundle;
    if (!info || !info.length) return;
    const n = info.length;
    for (let i = 0; i < n; i++) {
      const it = info[i];
      const share = it.len / totalLen;
      const dur   = Math.min(1200, 220 + share * 4500);
      const delay = START_DELAY_MS + Math.round((i / Math.max(1, n - 1)) * DRAW_WINDOW_MS);
      it.el.style.transition =
        `stroke-dashoffset ${dur}ms cubic-bezier(0.28, 0.11, 0.32, 1) ${delay}ms`;
      it.el.style.strokeDashoffset = '0';
    }
  }

  // One shared observer — cheaper than one per element and fires in
  // DOM order when many tiles scroll into view at once. Also uses the
  // window as root so it works whether body or html owns the scroll.
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const ent of entries) {
          if (!ent.isIntersecting) continue;
          animate(ent.target);
          io.unobserve(ent.target);
        }
      }, { root: null, rootMargin: '80px', threshold: 0.05 })
    : null;

  function observeForDraw(svg) {
    if (!io) { animate(svg); return; }  // no IO support = just draw now
    io.observe(svg);
  }

  function run() {
    // (a) Traced <img> tiles: swap to inline SVG, prep empty, observe.
    document.querySelectorAll('img.device.traced, img.traced').forEach(inlineOneTraced);

    // (b) Already-inline <svg class="device"> tiles (esp-s3-key,
    //     watch-badusb, and any legacy inline device figures on the
    //     hub). They never had a draw-in animation; give them one
    //     using the same prep+observe pipeline. Skip figures that
    //     already declare their own path-level animation (styleSheet
    //     targeting `.device path { animation: draw ... }`) so we
    //     don't fight an existing effect.
    document.querySelectorAll('svg.device').forEach(svg => {
      if (svg.__drawInfo) return;                              // already handled
      // If any path already has stroke-dasharray declared from CSS
      // (the flasher-subpage animation pattern), skip — the built-in
      // animation is already playing.
      const first = svg.querySelector('path');
      if (first) {
        const cs = window.getComputedStyle(first);
        const dashArray = cs.strokeDasharray;
        if (dashArray && dashArray !== 'none' && dashArray !== '0') return;
      }
      prepareEmpty(svg);
      observeForDraw(svg);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
