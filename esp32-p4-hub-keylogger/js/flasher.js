// ESP32-P4 Hub Keylogger — unified WebFlasher (P4 + C6 in one page)
// Runs the same wizard chrome as the other flashers-hub flashers, but with
// TWO chip targets: the ESP32-P4 side (bootloader + partitions + app) and
// the on-board ESP32-C6 side (bootloader + partitions + app + storage).
// Each has its own Connect + Hold-to-Flash button, its own progress cells,
// its own manifest under firmware/<chip>/. The wizard walks users through
// them in sequence: Brief → Boot P4 → Connect P4 → Flash P4 → Boot C6 →
// Connect C6 → Flash C6 → Done.
//
// Each Connect button verifies that the port's detected chip family matches
// the current step (so left-switch-on-P4 while trying to flash the C6 is a
// clear error, not a bricked chip).

import { ESPLoader, Transport } from '../vendor/esptool-bundle.js';

const $  = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// ---- Log ------------------------------------------------------------------
const MAX_LOG_LINES = 500;
const pad2 = n => String(n).padStart(2, '0');
function tsNow() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function log(msg, cls) {
  const el = $('consoleOut'); if (!el) return;
  String(msg).split('\n').forEach(part => {
    if (part === '') return;
    const line = document.createElement('div');
    const t = document.createElement('span'); t.className = 'ts'; t.textContent = `[${tsNow()}] `;
    const b = document.createElement('span'); if (cls) b.className = cls; b.textContent = part;
    line.appendChild(t); line.appendChild(b); el.appendChild(line);
  });
  while (el.childElementCount > MAX_LOG_LINES) el.removeChild(el.firstElementChild);
  el.scrollTop = el.scrollHeight;
  if (cls === 'err') openDrawer('console');
}
const espTerminal = {
  clean() {},
  writeLine(data) { log(String(data)); },
  write(data) { const t = String(data).trim(); if (t) log(t); },
};

// ---- Drawers --------------------------------------------------------------
const DRAWERS = { console: 'btnConsole', filesDrawer: 'btnFiles' };
let drawerOpener = null;
function openDrawer(id, moveFocus) {
  const wasOpen = Object.keys(DRAWERS).some(d => $(d).classList.contains('is-open'));
  Object.keys(DRAWERS).forEach(d => {
    const el = $(d), btn = $(DRAWERS[d]), on = d === id;
    el.classList.toggle('is-open', on); el.inert = !on;
    if (btn) btn.setAttribute('aria-expanded', String(on));
  });
  if (id === 'console') { const out = $('consoleOut'); out.scrollTop = out.scrollHeight; }
  if (id) {
    if (!moveFocus) return;
    if (!wasOpen) drawerOpener = document.activeElement;
    const close = $(id).querySelector('.x'); if (close) close.focus({ preventScroll: true });
  } else if (wasOpen && drawerOpener && document.contains(drawerOpener)) {
    drawerOpener.focus({ preventScroll: true }); drawerOpener = null;
  }
}
function closeDrawers() { openDrawer(null); }
Object.keys(DRAWERS).forEach(d => $(DRAWERS[d]).addEventListener('click', () =>
  $(d).classList.contains('is-open') ? closeDrawers() : openDrawer(d, true)));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDrawers));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawers(); });

// ---- Wizard ---------------------------------------------------------------
const LAST_STEP = 7; // the "Done" view at data-step="7"
let step = 0;
const views = $$('.view');
const rail  = $$('#rail li');

function syncRail(n) {
  rail.forEach(li => {
    const i = +li.dataset.step;
    const current = i === n && n < LAST_STEP;
    li.classList.toggle('on', current);
    li.classList.toggle('done', i < n);
    let fill; if (i < n) fill = 100; else if (current) fill = Math.round((n + 1) / rail.length * 100); else fill = 0;
    li.style.setProperty('--fill', fill);
    if (current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    const btn = li.querySelector('.railbtn'); if (btn) btn.disabled = i >= n;
  });
}
function goTo(n) {
  if (n === step) return;
  const from = views.find(v => +v.dataset.step === step);
  const to   = views.find(v => +v.dataset.step === n);
  if (!to) return;
  if (from) { from.classList.remove('is-on'); from.classList.add('is-out'); setTimeout(() => from.classList.remove('is-out'), 320); }
  to.classList.add('is-on');
  step = n; document.body.dataset.step = String(n); syncRail(n);
  const h = to.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goTo(+b.dataset.go)));
rail.forEach(li => { const btn = li.querySelector('.railbtn'); if (btn) btn.addEventListener('click', () => { if (li.classList.contains('done')) goTo(+li.dataset.step); }); });

// ---- Skip-steps override -------------------------------------------------
// The "Understood, begin" button in step 0 has a static data-go="1" so it
// still works without JS. When JS is up we override its click to honour
// the two "already flashed" checkboxes: skip past P4 (jump to Boot C6),
// skip past C6 (jump to Done), or skip both.
(function wireBeginSkip() {
  const begin = $('btnBegin'); if (!begin) return;
  begin.addEventListener('click', (e) => {
    const skipP4 = $('skipP4') && $('skipP4').checked;
    const skipC6 = $('skipC6') && $('skipC6').checked;
    let target = 1;                                      // Boot P4
    if (skipP4 && skipC6) target = 7;                    // straight to Done
    else if (skipP4)       target = 4;                   // Boot C6
    else if (skipC6)       target = 1;                   // still start at P4
    if (target === 1) {
      // Even when target === 1, still set the C6-skip flag if that box
      // alone is checked, so P4 completion later jumps to Done.
      if (skipC6 && !skipP4) window.__skipC6AfterP4 = true;
      return;                                            // fallthrough to data-go="1"
    }
    e.preventDefault();
    // stopImmediatePropagation prevents the bubble-phase data-go handler
    // on the same button from firing (it was registered as a plain click
    // listener earlier in this file).
    e.stopImmediatePropagation();
    if (skipC6 && !skipP4) {
      // "C6 already flashed" alone means: after P4 flash goes clean, jump
      // over the C6 half instead of stepping through Boot/Connect/Flash C6.
      window.__skipC6AfterP4 = true;
    }
    goTo(target);
  }, true);                                              // capture so data-go doesn't fire
})();

// ---- Page-map progress ----------------------------------------------------
// One page-map per chip (each has its own pagemap element).
const MAP_MAX_CELLS = 96;
const mapCellsByChip = { p4: [], c6: [] };

function buildPageMap(chip, units) {
  const wrap = $('pagemap' + chip.toUpperCase()); if (!wrap) return;
  const n = Math.max(1, Math.min(units, MAP_MAX_CELLS));
  wrap.textContent = ''; mapCellsByChip[chip] = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i'); c.style.setProperty('--i', i);
    wrap.appendChild(c); mapCellsByChip[chip].push(c);
  }
  wrap.classList.remove('is-done', 'is-error', 'is-erasing');
  wrap.setAttribute('aria-valuenow', '0');
}
function paintProgress(chip, done, total) {
  const wrap = $('pagemap' + chip.toUpperCase());
  const cells = mapCellsByChip[chip] || [];
  const upto = Math.round(cells.length * done / (total || 1));
  for (let i = 0; i < cells.length; i++) {
    cells[i].classList.toggle('on',   i <  upto);
    cells[i].classList.toggle('next', i === upto);
  }
  const pct = Math.round(100 * done / (total || 1));
  if (wrap) wrap.setAttribute('aria-valuenow', String(pct));
  const dEl = $('rdDone' + chip.toUpperCase()), tEl = $('rdTotal' + chip.toUpperCase());
  if (dEl) dEl.textContent = Math.round(done / 1024);
  if (tEl) tEl.textContent = Math.round(total / 1024);
}
function mapState(chip, state) {
  const wrap = $('pagemap' + chip.toUpperCase()); if (!wrap) return;
  wrap.classList.toggle('is-erasing', state === 'erasing');
  wrap.classList.toggle('is-done',    state === 'done');
  wrap.classList.toggle('is-error',   state === 'error');
  if (state) mapCellsByChip[chip].forEach(c => c.classList.remove('next'));
  if (state === 'error') {
    const next = mapCellsByChip[chip].find(c => !c.classList.contains('on'));
    if (next) next.classList.add('fail');
  }
}
function setPhase(chip, text) {
  const e = $('phase' + chip.toUpperCase()); if (e) e.textContent = text;
  const f = $('footStat'); if (f) f.textContent = `${chip.toUpperCase()}: ${text}`;
}
function setStatus(text, state) {
  const l = $('statusText'), w = $('status');
  if (l) l.textContent = text; if (w) w.dataset.state = state || 'idle';
  document.body.dataset.state = state || 'idle';
}
function showFlashError(chip, msg) {
  const el = $('flashErr' + chip.toUpperCase()); if (!el) return;
  el.hidden = !msg; el.textContent = msg || '';
}

// ---- Image loading --------------------------------------------------------
function bufToBinaryString(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return out;
}
async function fetchPart(base, path) {
  const r = await fetch(base + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${base + path}: HTTP ${r.status}`);
  return r.arrayBuffer();
}
async function loadManifestImages(chip) {
  const base = `./firmware/${chip}/`;
  const r = await fetch(base + 'manifest.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`firmware/${chip}/manifest.json: HTTP ${r.status}`);
  const man = await r.json();
  const parts = [];
  for (const p of man.parts) {
    const buf = await fetchPart(base, p.path);
    parts.push({ data: bufToBinaryString(buf), address: p.offset, bytes: buf.byteLength });
    log(`${chip}/${p.path}: ${buf.byteLength} B @ 0x${p.offset.toString(16)}`);
  }
  const pn = $('pickName' + chip.toUpperCase()); if (pn) pn.textContent = `firmware/${chip} · v${man.version || '?'}`;
  return { parts, chip: man.chip || '' };
}

// ---- Per-chip session (WebSerial + esptool) -------------------------------
// The two sessions are fully independent — connecting to the P4 does not
// touch the C6 state and vice versa. writeFlash is single-threaded per chip.
const sessions = {
  p4: { transport: null, esploader: null, images: null, flashing: false },
  c6: { transport: null, esploader: null, images: null, flashing: false },
};
const CHIP_STEPS = { p4: { connect: 2, flash: 3, next: 4 },
                     c6: { connect: 5, flash: 6, next: 7 } };
const CHIP_FAMILY = { p4: 'ESP32-P4', c6: 'ESP32-C6' };

// --- friendlier error hints -----------------------------------------------
// esptool-js surfaces a few common failure modes as raw text. Translate the
// ones that have an obvious operator recovery so the user doesn't have to
// know what "head of packet 0x45" means (it's the ASCII 'E' from an ESP-IDF
// log line — the chip skipped download mode and booted the app instead).
function hintForError(chip, msg) {
  const s = String(msg || '');
  if (/head of packet/i.test(s) || /serial noise/i.test(s)) {
    const btn = chip === 'p4' ? 'BOOT' : 'C6_BOOT';
    const rst = chip === 'p4' ? 'RESET' : 'C6_RESET';
    return `The ${chip.toUpperCase()} answered with its normal app output, not the ROM boot loader ` +
           `(0x45 = 'E', the start of an ESP-IDF log line). It didn't enter download mode. ` +
           `Hold ${btn}, tap ${rst}, release ${btn}, then click Connect ${chip.toUpperCase()} again.`;
  }
  if (/Failed to connect/i.test(s) || /No serial data received/i.test(s)) {
    return `No response from the ${chip.toUpperCase()} on that port. Check the U4 switch position, ` +
           `and hold BOOT while tapping RESET before you click Connect.`;
  }
  if (/NetworkError/i.test(s) || /device has been lost/i.test(s)) {
    return `The USB port dropped mid-transfer — a CH334 hub glitch. ` +
           `Turn on "Hub-safe mode" in the options below (slower baud + no compression, ` +
           `~90 s for the C6 storage image), reset the ${chip.toUpperCase()} into ROM mode, and retry.`;
  }
  return null;
}

async function connectChip(chip) {
  const S = sessions[chip];
  const btn = $('btnConnect' + chip.toUpperCase());
  const flashBtn = $('btnFlash' + chip.toUpperCase());
  const badge = $('pickChip' + chip.toUpperCase());

  if (!('serial' in navigator)) { log('no WebSerial here. use Chrome/Edge/Opera/Brave/Arc.', 'err'); setStatus('No WebSerial', 'error'); return; }
  if (btn) btn.classList.add('loading');
  try {
    const port = await navigator.serial.requestPort({});
    S.transport = new Transport(port, true);
    S.esploader = new ESPLoader({
      transport: S.transport,
      baudrate: 921600, romBaudrate: 115200,
      terminal: espTerminal, debugLogging: false,
    });
    setStatus(`${chip.toUpperCase()}: connecting`, 'live');
    const chipDetected = await S.esploader.main();
    log(`${chip}/connect: ${chipDetected}`, 'ok');
    if (badge) badge.textContent = chipDetected;

    // Chip-family guard: refuse to write C6 images into a P4 (or vice-versa).
    const wanted = CHIP_FAMILY[chip];
    if (!String(chipDetected).toUpperCase().replace(/[-_]/g, '').includes(wanted.replace(/[-_]/g, '').toUpperCase())) {
      throw new Error(`Detected ${chipDetected}, but this step expects ${wanted}. Flip the U4 switch and retry.`);
    }
    setStatus(`${chipDetected} ready`, 'ok');

    // Preload the image set so the Hold-to-flash button lights up.
    if (!S.images) {
      try { const im = await loadManifestImages(chip); S.images = im.parts; }
      catch (e) { log(`${chip}/images: ` + e.message, 'err'); }
    }
    if (flashBtn) flashBtn.disabled = !S.images;
    goTo(CHIP_STEPS[chip].flash);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    if (e && (e.name === 'NotFoundError' || /No port selected/i.test(msg))) {
      log(`${chip}/connect: no port picked`);
    } else {
      log(`${chip}/connect: ` + msg, 'err');
      setStatus('Connect failed', 'error');
      // If we know how this specific failure looks, surface the actionable
      // hint INSTEAD of the raw stack — otherwise raw error text through.
      const hint = hintForError(chip, msg);
      showFlashError(chip, hint || msg);
    }
    try { if (S.transport) await S.transport.disconnect(); } catch (_) {}
    S.transport = null; S.esploader = null;
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}
if ($('btnConnectP4')) $('btnConnectP4').onclick = () => connectChip('p4');
if ($('btnConnectC6')) $('btnConnectC6').onclick = () => connectChip('c6');

async function runFlash(chip) {
  const S = sessions[chip];
  if (!S.esploader) { log(`${chip}/flash: connect first`, 'err'); return; }
  if (!S.images) {
    try { const im = await loadManifestImages(chip); S.images = im.parts; }
    catch (e) { log(`${chip}/images: ` + e.message, 'err'); return; }
  }
  const btn = $('btnFlash' + chip.toUpperCase());
  if (btn) btn.disabled = true;
  S.flashing = true;
  mapState(chip, null); showFlashError(chip, null);
  setStatus(`${chip.toUpperCase()}: flashing`, 'live');

  const total = S.images.reduce((n, p) => n + p.bytes, 0);
  const before = []; { let acc = 0; for (const p of S.images) { before.push(acc); acc += p.bytes; } }
  buildPageMap(chip, Math.max(24, Math.round(total / 4096)));
  const partsEl = $('rdParts' + chip.toUpperCase()); if (partsEl) partsEl.textContent = `0 / ${S.images.length} parts`;
  paintProgress(chip, 0, total);

  // Track whether every payload byte was reported as transmitted. If
  // writeFlash then throws AFTER all bytes hit 100%, the failure is very
  // likely just the trailing serial ACK — but we CANNOT assume the write
  // is truly durable, because SPIFFS/flash controller sees the last chunk
  // as untrusted until the "Leaving..." handshake commits it. So: on that
  // specific post-write error, we do NOT advance to Done. Instead we
  // surface it as an "ambiguous — reflash to be safe" state, distinct
  // from a mid-write failure, because for the C6 in particular an
  // interrupted storage.bin will boot into a silently-reformatted empty
  // SPIFFS (see the "SPIFFS partition is empty" page in the C6 firmware).
  let lastByteReported = false;
  let lastFileIndex = S.images.length - 1;
  try {
    setPhase(chip, 'writing');
    const eraseChk  = $('erase' + chip.toUpperCase());
    const rescueChk = $('rescue' + chip.toUpperCase());
    const eraseAll  = !!(eraseChk  && eraseChk.checked);
    const rescue    = !!(rescueChk && rescueChk.checked);
    if (eraseAll) log(`${chip}/flash: full-erase mode — wiping the whole chip first`, 'ok');
    if (rescue) {
      // Hub-safe mode: drop to the ROM baud (115200) and disable compression
      // for the whole write. This matches what a bare esptool CLI does at
      // "--baud 115200 --no-compress" — much slower but survives the CH334
      // hub's spurious disconnects on large sequential writes (the C6
      // storage.bin is the exemplar). We change baud AFTER stub upload so
      // the sync still runs at 921600.
      log(`${chip}/flash: hub-safe mode — dropping to 115200 baud, no compression`, 'ok');
      const setter = S.esploader.changeBaud || S.esploader.setBaudrate;
      if (setter) {
        try { await setter.call(S.esploader, 115200); }
        catch (e) { log(`${chip}/flash: could not lower baud (${e.message}); continuing anyway`, 'err'); }
      }
    }
    await S.esploader.writeFlash({
      fileArray: S.images.map(p => ({ data: p.data, address: p.address })),
      flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',
      eraseAll, compress: !rescue,
      reportProgress: (fileIndex, written, fileTotal) => {
        const done = (before[fileIndex] || 0) + written;
        paintProgress(chip, done, total);
        if (partsEl) partsEl.textContent = `${written >= fileTotal ? fileIndex + 1 : fileIndex} / ${S.images.length} parts`;
        if (fileIndex >= lastFileIndex && written >= fileTotal) lastByteReported = true;
      },
    });
    setPhase(chip, 'resetting');
    log(`${chip}/flash: done, resetting`, 'ok');
    try { await S.esploader.after('hard_reset'); } catch (_) {}
    paintProgress(chip, total, total);
    setPhase(chip, 'done'); mapState(chip, 'done');
    setStatus(`${chip.toUpperCase()}: flashed`, 'ok');

    // Drop the transport so the next step can grab the port cleanly.
    try { if (S.transport) await S.transport.disconnect(); } catch (_) {}
    S.transport = null; S.esploader = null;

    // Honour the "C6 already flashed" skip from step 0: after a clean P4
    // flash, jump straight to Done instead of stepping through the C6 half.
    let nextStep = CHIP_STEPS[chip].next;
    if (chip === 'p4' && window.__skipC6AfterP4) nextStep = 7;
    setTimeout(() => goTo(nextStep), 700);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    if (lastByteReported) {
      // Post-write serial glitch — common on the CH334 hub after the last
      // chunk of a large image (the C6 storage.bin especially). The write
      // MAY have committed, but SPIFFS can't checksum an image that never
      // saw the trailing "Leaving..." handshake, so on next boot the C6
      // will reformat and boot empty. Force a reflash.
      log(`${chip}/flash: reached 100% then hit a post-write serial glitch (${msg}). ` +
          `The chip may have booted with an INCOMPLETE image — reflash before trusting it.`, 'err');
      showFlashError(chip,
        `Wrote 100% of ${chip.toUpperCase()} but the final serial handshake failed (${msg}). ` +
        `On the C6 this typically boots with an empty SPIFFS (192.168.4.1 will show ` +
        `"SPIFFS partition is empty"). Reset the ${chip.toUpperCase()} back into ROM ` +
        `mode and rerun this step.`);
    } else {
      log(`${chip}/flash: ` + msg, 'err');
      const hint = hintForError(chip, msg);
      showFlashError(chip, hint || msg);
    }
    setPhase(chip, 'failed'); mapState(chip, 'error');
    setStatus(`${chip.toUpperCase()}: ${lastByteReported ? 'flash may be incomplete' : 'flash failed'}`, 'error');
    if (btn) btn.disabled = false;
    // Drop the transport so the reconnect path can grab it cleanly.
    try { if (S.transport) await S.transport.disconnect(); } catch (_) {}
    S.transport = null; S.esploader = null;
  } finally {
    S.flashing = false;
  }
}

// ---- Hold-to-flash (one wire-up per chip) ---------------------------------
const HOLD_MS = 700;
function wireHold(chip) {
  const btn = $('btnFlash' + chip.toUpperCase()); if (!btn) return;
  let timer = null;
  function reset() { if (timer) { clearTimeout(timer); timer = null; } btn.style.setProperty('--hold-dur', '140ms'); btn.style.setProperty('--hold', '0'); }
  function begin(e) {
    if (btn.disabled || sessions[chip].flashing || timer) return;
    if (e.cancelable) e.preventDefault();
    btn.style.setProperty('--hold-dur', HOLD_MS + 'ms'); btn.style.setProperty('--hold', '1');
    timer = setTimeout(() => { reset(); runFlash(chip); }, HOLD_MS);
  }
  btn.addEventListener('pointerdown', begin);
  btn.addEventListener('pointerup', reset);
  btn.addEventListener('pointerleave', reset);
  btn.addEventListener('pointercancel', reset);
  btn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) begin(e); });
  btn.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') reset(); });
  btn.addEventListener('blur', reset);
}
wireHold('p4');
wireHold('c6');

// ---- Boot -----------------------------------------------------------------
document.body.dataset.step = '0';
syncRail(0);
setStatus('No device', 'idle');
setPhase('p4', 'ready'); setPhase('c6', 'ready');
if (!('serial' in navigator)) {
  log('no WebSerial in this browser. use Chrome, Edge, Opera, Brave or Arc.', 'err');
  const p4 = $('btnConnectP4'), c6 = $('btnConnectC6');
  if (p4) p4.disabled = true; if (c6) c6.disabled = true;
  setStatus('No WebSerial', 'error');
}
window.addEventListener('beforeunload', ev => {
  if (sessions.p4.flashing || sessions.c6.flashing) { ev.preventDefault(); ev.returnValue = ''; }
});
