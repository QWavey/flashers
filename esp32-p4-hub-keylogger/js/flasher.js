// ESP32-P4 Hub Keylogger — unified WebFlasher (P4 + C6 in one page).
// Uses esptool-js (the JS port of esptool) over WebSerial. Each of the two
// "Connect & flash <chip>" buttons opens its own port, verifies the chip
// family matches, writes that chip's manifest.json image set, hard-resets.

import { ESPLoader, Transport } from '../vendor/esptool-bundle.js';

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// -----------------------------------------------------------------------
// Traced hero figure — inline the SVG so we can layer live cue callouts
// (a pulsing halo around the chip that's being flashed right now) on top.
// -----------------------------------------------------------------------
(async function loadHero() {
  const host = document.getElementById('figHost');
  if (!host) return;
  try {
    const [svgText, anchorsResp] = await Promise.all([
      fetch('assets/figure.svg', { cache: 'no-store' }).then(r => r.text()),
      fetch('assets/figure.anchors.json', { cache: 'no-store' }).then(r => r.json()),
    ]);
    host.innerHTML = svgText;
    const svg = host.querySelector('svg');
    if (!svg) return;
    // remove any width/height so it fluid-fits, keep the tight viewBox
    svg.removeAttribute('width'); svg.removeAttribute('height');
    // add the cue overlay group
    const NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'cues');
    const anchors = anchorsResp.labels || {};
    const cueP4 = mkHalo(anchors['P4'] || anchors['ESP32-P4'],      100, 'p4');
    const cueC6 = mkHalo(anchors['C6'] || anchors['ESP32-C6-MINI'],  80, 'c6');
    const lblP4 = mkLabel(anchors['P4'] || anchors['ESP32-P4'],      'P4', 100, 'p4');
    const lblC6 = mkLabel(anchors['C6'] || anchors['ESP32-C6-MINI'], 'C6',  80, 'c6');
    for (const el of [cueP4, cueC6, lblP4, lblC6]) if (el) g.appendChild(el);
    svg.appendChild(g);

    function mkHalo(pt, r, kind) {
      if (!pt) return null;
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', 'cue-halo');
      c.setAttribute('cx', pt[0]); c.setAttribute('cy', pt[1]); c.setAttribute('r', r);
      c.dataset.chip = kind;
      return c;
    }
    function mkLabel(pt, text, r, kind) {
      if (!pt) return null;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('class', 'cue-label');
      t.setAttribute('x', pt[0]); t.setAttribute('y', pt[1] - r - 14);
      t.setAttribute('text-anchor', 'middle');
      t.textContent = 'now flashing: ' + text;
      t.dataset.chip = kind;
      return t;
    }
  } catch (e) {
    host.innerHTML = '<div style="color:#8a8a8f;padding:32px;text-align:center;font-family:IBM Plex Mono,monospace;font-size:12px">figure unavailable</div>';
    console.warn('hero:', e);
  }
})();

// -----------------------------------------------------------------------
// Wizard state — mark the "live" step + highlight the matching chip cue.
// -----------------------------------------------------------------------
function setActiveStep(n) {
  $$('.step').forEach(s => {
    const i = +s.dataset.step;
    s.dataset.active = (i === n);
    s.classList.toggle('done', i < n);
  });
  // cues on the traced figure
  const chip = ($('.step[data-active="true"]')?.dataset.chip) || null;
  $$('.cue-halo, .cue-label').forEach(el => el.classList.toggle('on', chip && el.dataset.chip === chip));
}
setActiveStep(2); // start users on "prepare P4"

// -----------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------
function pad2(n){return String(n).padStart(2,'0')}
function ts(){const d=new Date();return `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}] `}

function log(chip, msg, cls) {
  const el = document.querySelector(`[data-log="${chip}"]`);
  if (!el) return;
  String(msg).split('\n').forEach(line => {
    if (!line) return;
    const row = document.createElement('div');
    const t = document.createElement('span'); t.className='ts'; t.textContent = ts();
    const b = document.createElement('span'); if (cls) b.className = cls; b.textContent = line;
    row.append(t, b); el.appendChild(row);
  });
  el.scrollTop = el.scrollHeight;
  const box = document.querySelector(`[data-log-toggle="${chip}"]`);
  if (box && !box.checked) { box.checked = true; el.classList.add('on'); }
}

function setStatus(chip, text, tone) {
  const el = document.querySelector(`[data-status="${chip}"]`);
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone || '';
}
function setProgress(chip, done, total) {
  const bar = document.querySelector(`[data-progress="${chip}"] > div`);
  if (!bar) return;
  const p = total ? Math.max(0, Math.min(1, done / total)) : 0;
  bar.style.width = (p * 100).toFixed(1) + '%';
}
function bufToBinary(buf){
  const bytes = new Uint8Array(buf); const CHUNK = 0x8000; let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return out;
}
async function loadImages(chip) {
  const base = `firmware/${chip}/`;
  const man = await (await fetch(base + 'manifest.json', { cache: 'no-store' })).json();
  // Accept both flasher-forge's flat manifest ({chip, parts:[...]}) and the
  // classic esp-web-tools shape ({builds:[{chipFamily, parts:[...]}]}).
  const built = (man.builds && man.builds[0]) || null;
  const partList = (built && built.parts) || man.parts || [];
  const chipFamily = (built && built.chipFamily) || man.chip || '';
  const parts = [];
  for (const p of partList) {
    const buf = await (await fetch(base + p.path, { cache: 'no-store' })).arrayBuffer();
    parts.push({ address: p.offset, data: bufToBinary(buf), bytes: buf.byteLength, path: p.path });
    log(chip, `image ${p.path} ${buf.byteLength} B @ 0x${p.offset.toString(16)}`);
  }
  return { chipFamily, parts };
}

// One captive esptool session per chip (never share transports across chips).
const sessions = { p4: null, c6: null };

const CHIP_STEP = { p4: 3, c6: 5 };

async function flashChip(chip) {
  const btn = document.querySelector(`button[data-flash="${chip}"]`);
  if (!btn) return;
  btn.disabled = true;
  setActiveStep(CHIP_STEP[chip]);

  if (!('serial' in navigator)) {
    setStatus(chip, 'WebSerial unavailable', 'err');
    log(chip, 'no WebSerial in this browser — use Chrome, Edge, Opera, Brave, Arc.', 'err');
    btn.disabled = false; return;
  }

  const terminal = {
    clean(){}, writeLine(s){ log(chip, String(s)); },
    write(s){ const t = String(s).trim(); if (t) log(chip, t); },
  };

  let transport = null, esploader = null;
  try {
    setStatus(chip, 'requesting port', 'live');
    const port = await navigator.serial.requestPort({});
    transport = new Transport(port, true);
    esploader = new ESPLoader({
      transport, baudrate: 921600, romBaudrate: 115200,
      terminal, debugLogging: false,
    });

    setStatus(chip, 'connecting', 'live');
    const detected = await esploader.main();
    log(chip, `detected: ${detected}`, 'ok');

    // Guard: refuse to write ESP32-C6 images into a P4 (and vice-versa).
    const wantFamily = (chip === 'p4') ? 'esp32-p4' : 'esp32-c6';
    if (!String(detected).toLowerCase().includes(wantFamily)) {
      throw new Error(`this port is a ${detected}, but the ${chip.toUpperCase()} step expects ${wantFamily.toUpperCase()}. Flip the U4 switch and retry.`);
    }
    setStatus(chip, detected, 'ok');

    setStatus(chip, 'fetching firmware', 'live');
    const { parts } = await loadImages(chip);
    const total = parts.reduce((n, p) => n + p.bytes, 0);
    const before = []; { let a=0; for (const p of parts){ before.push(a); a += p.bytes; } }

    setStatus(chip, 'flashing', 'live');
    await esploader.writeFlash({
      fileArray: parts.map(p => ({ data: p.data, address: p.address })),
      flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',
      eraseAll: false, compress: true,
      reportProgress: (idx, written, fileTotal) => {
        const done = (before[idx] || 0) + written;
        setProgress(chip, done, total);
      },
    });
    setProgress(chip, total, total);
    setStatus(chip, 'resetting', 'live');
    try { await esploader.after('hard_reset'); } catch (_) {}
    setStatus(chip, 'done ✓', 'ok');
    log(chip, 'flash complete.', 'ok');

    // Advance the wizard: after P4 → prep C6, after C6 → done.
    setActiveStep(chip === 'p4' ? 4 : 6);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    if (e && (e.name === 'NotFoundError' || /No port selected/i.test(msg))) {
      log(chip, 'no port picked.');
      setStatus(chip, 'cancelled', '');
    } else {
      log(chip, msg, 'err');
      setStatus(chip, 'failed', 'err');
    }
  } finally {
    try { if (transport) await transport.disconnect(); } catch (_) {}
    sessions[chip] = null;
    btn.disabled = false;
  }
}

// Wire up buttons + log toggles.
$$('button[data-flash]').forEach(b => b.addEventListener('click', () => flashChip(b.dataset.flash)));
$$('[data-log-toggle]').forEach(cb => cb.addEventListener('change', () => {
  const chip = cb.dataset.logToggle;
  const el = document.querySelector(`[data-log="${chip}"]`);
  if (el) el.classList.toggle('on', cb.checked);
}));

// Selecting a step by clicking it also updates the cue overlay.
$$('.step').forEach(s => s.addEventListener('click', () => setActiveStep(+s.dataset.step)));
