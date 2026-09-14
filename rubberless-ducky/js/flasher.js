// Rubberless-Ducky WebFlasher
// Minimal Atmel AVR32 DFU flasher over WebUSB.
// Protocol reference: dfu-programmer (src/atmel.c). Targets AT32UC3B parts.
// WebUSB can only open the device when no other driver has claimed it
// (WinUSB via Zadig on Windows, a udev rule for VID 03EB on Linux).

const $ = id => document.getElementById(id);

// ---- Log ------------------------------------------------------------------
const MAX_LOG_LINES = 400;
const pad2 = n => String(n).padStart(2, '0');

function tsNow() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function log(msg, cls) {
  const el = $('consoleOut');
  if (!el) return;
  const line = document.createElement('div');
  const t = document.createElement('span');
  t.className = 'ts';
  t.textContent = `[${tsNow()}] `;
  const b = document.createElement('span');
  if (cls) b.className = cls;
  b.textContent = msg;
  line.appendChild(t);
  line.appendChild(b);
  el.appendChild(line);
  while (el.childElementCount > MAX_LOG_LINES) el.removeChild(el.firstElementChild);
  el.scrollTop = el.scrollHeight;
  if (cls === 'err') openDrawer('console');   // an error should not need hunting for
}

// ---- Drawers --------------------------------------------------------------
const DRAWERS = { console: 'btnConsole', filesDrawer: 'btnFiles' };

let drawerOpener = null;

function openDrawer(id, moveFocus) {
  const wasOpen = Object.keys(DRAWERS).some(d => $(d).classList.contains('is-open'));
  Object.keys(DRAWERS).forEach(d => {
    const el = $(d);
    const btn = $(DRAWERS[d]);
    const on = d === id;
    el.classList.toggle('is-open', on);
    el.inert = !on;
    if (btn) btn.setAttribute('aria-expanded', String(on));
  });
  if (id === 'console') {
    const out = $('consoleOut');
    out.scrollTop = out.scrollHeight;
  }
  if (id) {
    // Only pull focus when a person opened the drawer. An error opens the log
    // by itself, and yanking focus out of a flash in progress would be worse
    // than leaving it where it is.
    if (!moveFocus) return;
    if (!wasOpen) drawerOpener = document.activeElement;
    const close = $(id).querySelector('.x');
    if (close) close.focus({ preventScroll: true });
  } else if (wasOpen && drawerOpener && document.contains(drawerOpener)) {
    drawerOpener.focus({ preventScroll: true });
    drawerOpener = null;
  }
}

function closeDrawers() { openDrawer(null); }

Object.keys(DRAWERS).forEach(d => {
  $(DRAWERS[d]).addEventListener('click', () => {
    $(d).classList.contains('is-open') ? closeDrawers() : openDrawer(d, true);
  });
});

document.querySelectorAll('[data-close]').forEach(b => {
  b.addEventListener('click', closeDrawers);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDrawers();
});

// ---- Wizard ---------------------------------------------------------------
// Five views: 0 brief, 1 DFU, 2 connect, 3 flash, 4 done. The rail only shows
// the four that are steps; view 4 is the terminal state.
const LAST_STEP = 4;
let step = 0;

const views = [...document.querySelectorAll('.view')];
const rail  = [...document.querySelectorAll('#rail li')];

function syncRail(n) {
  rail.forEach(li => {
    const i = +li.dataset.step;
    const current = i === n && n < LAST_STEP;
    li.classList.toggle('on', current);
    li.classList.toggle('done', i < n);
    // The dial shows overall progress on the current pip (Brief 1/4 … Flash
    // 4/4); a step already behind you is full. Both use the same --fill, so a
    // pip fills the same way whether the line is passing through it now or has
    // already passed.
    let fill;
    if (i < n) fill = 100;
    else if (current) fill = Math.round((n + 1) / rail.length * 100);
    else fill = 0;
    li.style.setProperty('--fill', fill);
    if (current) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
    const btn = li.querySelector('.railbtn');
    if (btn) btn.disabled = i >= n;
  });
}

function goTo(n) {
  if (n === step) return;
  const from = views.find(v => +v.dataset.step === step);
  const to   = views.find(v => +v.dataset.step === n);
  if (!to) return;

  if (from) {
    from.classList.remove('is-on');
    from.classList.add('is-out');
    setTimeout(() => from.classList.remove('is-out'), 320);
  }
  to.classList.add('is-on');

  step = n;
  document.body.dataset.step = String(n);
  syncRail(n);

  // Move focus to the new view's heading so keyboard and screen reader users
  // land where the sighted eye already is.
  const h = to.querySelector('h1');
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
}

document.querySelectorAll('[data-go]').forEach(b => {
  b.addEventListener('click', () => goTo(+b.dataset.go));
});

rail.forEach(li => {
  const btn = li.querySelector('.railbtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (li.classList.contains('done')) goTo(+li.dataset.step);
  });
});

// ---- Readouts -------------------------------------------------------------
// The page map is the progress readout: one cell per 512-byte page. Above a
// few dozen pages one cell stands for several, so a 256 KB image still fits;
// the page counts in the legend stay true either way.
const MAP_MAX_CELLS = 96;
let mapCells = [];

function buildPageMap(totalPages) {
  const wrap = $('pagemap');
  if (!wrap) return;
  const n = Math.max(1, Math.min(totalPages, MAP_MAX_CELLS));
  wrap.textContent = '';
  mapCells = [];
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('i');
    cell.style.setProperty('--i', i);
    wrap.appendChild(cell);
    mapCells.push(cell);
  }
  wrap.classList.remove('is-done', 'is-error', 'is-erasing');
  wrap.setAttribute('aria-valuenow', '0');
  $('rdPagesTotal').textContent = totalPages;
  $('rdPages').textContent = '0';
}

function paintProgress(bytesDone, bytesTotal, pagesDone, pagesTotal) {
  const wrap = $('pagemap');
  const upto = Math.round(mapCells.length * pagesDone / pagesTotal);
  for (let i = 0; i < mapCells.length; i++) {
    // toggle() with an explicit second argument leaves an already-on cell
    // untouched, so the fill animation plays once per page rather than
    // restarting on every repaint.
    mapCells[i].classList.toggle('on', i < upto);
    mapCells[i].classList.toggle('next', i === upto);
  }
  const pct = Math.round(100 * bytesDone / bytesTotal);
  if (wrap) {
    wrap.setAttribute('aria-valuenow', String(pct));
    wrap.setAttribute('aria-valuetext', `${pagesDone} of ${pagesTotal} pages`);
  }
  $('rdDone').textContent  = bytesDone.toLocaleString();
  $('rdPages').textContent = pagesDone;
}

function showFlashError(msg) {
  const el = $('flashErr');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
}

function mapState(state) {
  const wrap = $('pagemap');
  if (!wrap) return;
  wrap.classList.toggle('is-erasing', state === 'erasing');
  wrap.classList.toggle('is-done',    state === 'done');
  wrap.classList.toggle('is-error',   state === 'error');
  if (state) mapCells.forEach(c => c.classList.remove('next'));
  if (state === 'error') {
    // Mark the page it stopped on, so the map says where as well as whether.
    const next = mapCells.find(c => !c.classList.contains('on'));
    if (next) next.classList.add('fail');
  }
}

function setPhase(text) {
  const el = $('phase');
  const foot = $('footStat');
  if (el) el.textContent = text;
  if (foot) foot.textContent = text;
}

function setStatus(text, state) {
  const label = $('statusText');
  const wrap = $('status');
  if (label) label.textContent = text;
  if (wrap) wrap.dataset.state = state || 'idle';
  document.body.dataset.state = state || 'idle';
}

// ---- Atmel AVR32 DFU ------------------------------------------------------
const VID = 0x03EB;
const DFU_PIDS = [0x2FF6, 0x2FF7, 0x2FF8, 0x2FF1, 0x2FFA, 0x2FFB];
const DFU_DNLOAD    = 0x01;
const DFU_GETSTATUS = 0x03;
const DFU_CLRSTATUS = 0x04;

// AT32UC3B1256: 256 KB of flash mapped at 0x80000000, with the DFU bootloader
// in the first 8 KB. Writing into that would remove the only way back onto the
// part, so an image reaching into it is refused.
const FLASH_BASE   = 0x80000000;
const FLASH_SIZE   = 0x40000;
const BOOT_RESERVE = 0x2000;
const PAGE = 512;

let device = null;
let iface  = 0;
let hexBytes = null;
let hexBase  = null;
let flashing = false;
let stopping = false;

// ---- Intel HEX ------------------------------------------------------------
function parseHex(text) {
  const lines = text.split(/\r?\n/);
  let ext = 0, seg = 0, sawEof = false;
  const map = new Map();

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n].trim();
    if (!raw) continue;
    if (raw[0] !== ':') throw new Error(`line ${n + 1}: does not start with ':'`);
    if (!/^:[0-9A-Fa-f]+$/.test(raw)) throw new Error(`line ${n + 1}: non-hex characters`);
    if (raw.length < 11) throw new Error(`line ${n + 1}: record too short`);

    const len = parseInt(raw.substr(1, 2), 16);
    if (raw.length !== 11 + len * 2) {
      throw new Error(`line ${n + 1}: length byte says ${len}, record carries ${(raw.length - 11) / 2}`);
    }

    // Every byte of the record, checksum included, sums to zero mod 256.
    let sum = 0;
    for (let i = 1; i < raw.length; i += 2) sum += parseInt(raw.substr(i, 2), 16);
    if ((sum & 0xFF) !== 0) throw new Error(`line ${n + 1}: bad checksum`);

    const addr = parseInt(raw.substr(3, 4), 16);
    const type = parseInt(raw.substr(7, 2), 16);
    const data = [];
    for (let i = 0; i < len; i++) data.push(parseInt(raw.substr(9 + i * 2, 2), 16));

    if (type === 0x00) {
      const base = (ext * 0x10000) + seg;
      for (let i = 0; i < len; i++) map.set(base + addr + i, data[i]);
    } else if (type === 0x04) {
      if (len !== 2) throw new Error(`line ${n + 1}: bad extended linear record`);
      ext = (data[0] << 8) | data[1];
    } else if (type === 0x02) {
      if (len !== 2) throw new Error(`line ${n + 1}: bad extended segment record`);
      seg = ((data[0] << 8) | data[1]) << 4;
    } else if (type === 0x01) {
      sawEof = true;
      break;
    }
    // Types 03 and 05 carry a start address; nothing to do with them here.
  }

  if (!sawEof) throw new Error('no end-of-file record');
  if (map.size === 0) throw new Error('no data records');

  const addrs = [...map.keys()].sort((a, b) => a - b);
  const base = addrs[0];
  const end  = addrs[addrs.length - 1];
  const bytes = new Uint8Array(end - base + 1).fill(0xFF);
  for (const [a, b] of map) bytes[a - base] = b;
  return { base, bytes };
}

// Offset into flash, or a refusal the user can act on.
function flashOffsetFor(base, length) {
  const offset = base >= FLASH_BASE ? base - FLASH_BASE : base;

  if (offset < 0 || offset >= FLASH_SIZE) {
    throw new Error(
      `based at 0x${base.toString(16)}, outside the ${FLASH_SIZE / 1024} KB flash ` +
      `window at 0x${FLASH_BASE.toString(16)}`
    );
  }
  if (offset < BOOT_RESERVE) {
    throw new Error(
      `starts at 0x${offset.toString(16)}, inside the ${BOOT_RESERVE / 1024} KB DFU ` +
      `bootloader. Flashing it would leave no way back onto the part`
    );
  }
  if (offset + length > FLASH_SIZE) {
    throw new Error(`runs past the end of flash by ${offset + length - FLASH_SIZE} bytes`);
  }
  return offset;
}

// ---- Transfers ------------------------------------------------------------
async function ctrl(setup, data) {
  const req = {
    requestType: 'class', recipient: 'interface',
    request: setup.bRequest, value: setup.wValue, index: iface
  };
  if (data) return device.controlTransferOut(req, data);
  return device.controlTransferIn(req, setup.wLength);
}

async function dfuStatus() {
  const r = await ctrl({ bRequest: DFU_GETSTATUS, wValue: 0, wLength: 6 });
  const v = new Uint8Array(r.data.buffer);
  return { status: v[0], pollTimeout: v[1] | (v[2] << 8) | (v[3] << 16), state: v[4] };
}

async function dfuClrStatus() {
  await ctrl({ bRequest: DFU_CLRSTATUS, wValue: 0 }, new Uint8Array());
}

async function waitIdle() {
  for (let i = 0; i < 200; i++) {
    const s = await dfuStatus();
    if (s.status !== 0) throw new Error('DFU error status ' + s.status);
    if (s.state === 2 || s.state === 5) return s;
    await new Promise(r => setTimeout(r, Math.max(5, s.pollTimeout)));
  }
  throw new Error('DFU did not go idle');
}

async function atmelWrite(bytes) {
  await ctrl({ bRequest: DFU_DNLOAD, wValue: 0 }, bytes);
  await waitIdle();
}

async function chipErase() {
  log('erase: whole chip');
  setPhase('erasing');
  mapState('erasing');
  await atmelWrite(new Uint8Array([0x04, 0x00, 0xFF]));
  mapState(null);
  log('erase: done', 'ok');
}

async function selectRegion(region) {
  await atmelWrite(new Uint8Array([0x06, 0x03, region]));
}

async function setBasePage(page16k) {
  await atmelWrite(new Uint8Array([0x06, 0x03, (page16k >> 8) & 0xFF, page16k & 0xFF]));
}

async function programBlock(startOffset, payload) {
  const end = startOffset + payload.length - 1;
  const header = new Uint8Array([
    0x01, 0x00,
    (startOffset >> 8) & 0xFF, startOffset & 0xFF,
    (end >> 8) & 0xFF,         end & 0xFF
  ]);
  const buf = new Uint8Array(header.length + payload.length);
  buf.set(header, 0);
  buf.set(payload, header.length);
  await atmelWrite(buf);
}

async function programAll(bytes, base) {
  const flashBase = flashOffsetFor(base, bytes.length);
  await selectRegion(0x00);

  const total = bytes.length;
  const totalPages = Math.ceil(total / PAGE);
  let done = 0;
  let pagesDone = 0;
  let curPage16k = -1;

  setPhase('programming');
  buildPageMap(totalPages);
  for (let off = 0; off < total; off += PAGE) {
    const abs = flashBase + off;
    const page16k = abs >> 16;
    if (page16k !== curPage16k) {
      await setBasePage(page16k);
      curPage16k = page16k;
    }
    const chunk = bytes.subarray(off, Math.min(off + PAGE, total));
    await programBlock(abs & 0xFFFF, chunk);
    done += chunk.length;
    pagesDone++;
    paintProgress(done, total, pagesDone, totalPages);
    if (pagesDone % 8 === 0) log(`program: ${done}/${total} bytes`);
  }
  log(`program: ${total} bytes done`, 'ok');
}

async function launchDevice() {
  setPhase('resetting');
  await ctrl({ bRequest: DFU_DNLOAD, wValue: 0 }, new Uint8Array());
  log('launch: reset sent', 'ok');
}

function showImage(name, size, base) {
  const pages = Math.ceil(size / PAGE);
  const hex = n => '0x' + (n >>> 0).toString(16).padStart(8, '0');
  $('pickName').textContent = name;
  $('pickExtent').textContent = `${hex(base)} → ${hex(base + size - 1)}`;
  $('rdTotal').textContent = size.toLocaleString();
  $('rdDone').textContent = '0';
  buildPageMap(pages);
}

async function loadBundled() {
  const r = await fetch('./firmware.hex');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const parsed = parseHex(await r.text());
  flashOffsetFor(parsed.base, parsed.bytes.length);
  hexBytes = parsed.bytes;
  hexBase  = parsed.base;
  showImage('firmware.hex', hexBytes.length, hexBase);
  log(`firmware: bundled, ${hexBytes.length} bytes at 0x${hexBase.toString(16)}`, 'ok');
}

// ---- Figure draw-on -------------------------------------------------------
// Each shape gets its own path length so every line draws at the same speed
// instead of long ones lagging. Deliberately no requestAnimationFrame: a page
// opened in a background tab never runs one, and the figure would sit there
// invisible. A forced reflow between the two writes is enough to make the
// transition take.
function drawFigure() {
  const svg = document.querySelector('.device');
  if (!svg) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const shapes = [...svg.querySelectorAll('.shell *, .board *, .part *, .trace *, .passive *')]
    .filter(el => typeof el.getTotalLength === 'function');

  const measured = [];
  shapes.forEach(el => {
    let len = 0;
    try { len = el.getTotalLength(); } catch (e) { return; }
    if (!len) return;
    el.style.strokeDasharray  = len;
    el.style.strokeDashoffset = len;
    measured.push({ el, len });
  });
  if (!measured.length) return;

  measured.forEach(({ el, len }, i) => {
    const dur = Math.min(1100, 260 + len * 1.1);
    el.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(0.28,0.11,0.32,1) ${180 + i * 12}ms`;
  });

  void svg.getBoundingClientRect();          // flush the styles above
  measured.forEach(({ el }) => { el.style.strokeDashoffset = '0'; });
}

// ---- Wiring ---------------------------------------------------------------
drawFigure();
document.body.dataset.step = '0';
syncRail(0);
setStatus('No device', 'idle');
setPhase('ready');

$('btnConfirmPlug').onclick = () => goTo(2);

$('btnConnect').onclick = async () => {
  const btn = $('btnConnect');
  btn.classList.add('loading');
  try {
    device = await navigator.usb.requestDevice({
      filters: DFU_PIDS.map(p => ({ vendorId: VID, productId: p }))
    });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    for (const c of device.configurations) {
      for (const i of c.interfaces) {
        for (const a of i.alternates) {
          if (a.interfaceClass === 0xFE && a.interfaceSubclass === 0x01) {
            iface = i.interfaceNumber;
          }
        }
      }
    }
    await device.claimInterface(iface);

    const id = `${device.vendorId.toString(16).padStart(4, '0')}:${device.productId.toString(16).padStart(4, '0')}`;
    log(`connect: ${id}, interface ${iface}`, 'ok');
    setStatus(id, 'ok');

    try {
      const s = await dfuStatus();
      if (s.status !== 0) await dfuClrStatus();
    } catch (e) { /* a fresh part can answer the first GETSTATUS with junk */ }

    if (!hexBytes) {
      try { await loadBundled(); }
      catch (e) { log('bundled firmware: ' + e.message, 'err'); }
    }
    $('btnFlash').disabled = !hexBytes;
    goTo(3);
  } catch (e) {
    // Dismissing the browser picker is not a failure worth shouting about.
    if (e && e.name === 'NotFoundError') {
      log('connect: no device picked');
    } else {
      log('connect: ' + (e && e.message ? e.message : e), 'err');
      setStatus('Connect failed', 'error');
    }
  } finally {
    btn.classList.remove('loading');
  }
};

$('fileHex').onchange = async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const parsed = parseHex(await f.text());
    flashOffsetFor(parsed.base, parsed.bytes.length);   // refuse early, not mid-flash
    hexBytes = parsed.bytes;
    hexBase  = parsed.base;
    showImage(f.name, hexBytes.length, hexBase);
    $('btnFlash').disabled = !device;
    log(`firmware: ${f.name}, ${hexBytes.length} bytes at 0x${hexBase.toString(16)}`, 'ok');
  } catch (e) {
    log(`${f.name}: ${e.message}`, 'err');
    ev.target.value = '';
  }
};

async function runFlash() {
  if (!device) { log('flash: connect first', 'err'); return; }
  if (!hexBytes) {
    try { await loadBundled(); }
    catch (e) { log('bundled firmware: ' + e.message, 'err'); return; }
  }

  const btn = $('btnFlash');

  btn.disabled = true;
  flashing = true;
  mapState(null);
  showFlashError(null);
  setStatus('Flashing', 'live');

  try {
    await chipErase();
    await programAll(hexBytes, hexBase);
    await launchDevice();

    if (stopping) throw new Error('stopped');
    setPhase('done');
    mapState('done');
    setStatus('Flashed', 'ok');
    log('done. the device will re-enumerate as an HID keyboard.', 'ok');
    // "Flash multiple devices": drop this unit and loop back to Connect for the next.
    if ($('flashMany') && $('flashMany').checked) {
      log('flash many: unplug this device, plug the next, then Connect.', 'ok');
      device = null;
      $('btnFlash').disabled = true;
      setStatus('Next device', 'ok');
      setTimeout(() => goTo(2), 900);
    } else {
      setTimeout(() => goTo(4), 700);
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    log('flash: ' + msg, 'err');
    showFlashError(msg);
    setPhase('failed');
    // The map keeps every page it managed to write and marks the one it died
    // on: where it stopped is the most useful thing to know afterwards.
    mapState('error');
    setStatus('Flash failed', 'error');
    btn.disabled = false;
  } finally {
    flashing = false;
  }
}

// ---- Stop / reset: clear the progress cells and drop the connection --------
function clearPageMap() {
  mapCells.forEach(c => c.classList.remove('on', 'next', 'fail'));
  const wrap = $('pagemap');
  if (wrap) { wrap.classList.remove('is-done', 'is-error', 'is-erasing'); wrap.setAttribute('aria-valuenow', '0'); }
  if ($('rdDone')) $('rdDone').textContent = '0';
  if ($('rdPages')) $('rdPages').textContent = '0';
  setPhase('ready'); showFlashError(null);
}
async function stopFlash() {
  // Abort an in-flight program by closing the USB device (the next control
  // transfer then throws and its catch marks the error), then wipe the boxes.
  if (flashing) {
    stopping = true;
    log('stop: aborting flash', 'err');
    try { if (device) await device.close(); } catch (_) {}
    device = null;
  }
  flashing = false;
  clearPageMap();
  setStatus(device ? 'Connected' : 'No device', device ? 'ok' : 'idle');
  $('btnFlash').disabled = !device;
  stopping = false;
}
const _btnStop = $('btnStop'); if (_btnStop) _btnStop.addEventListener('click', stopFlash);

// Flashing cannot be undone, so it takes a deliberate press-and-hold rather
// than a single click that a stray tap could trigger. The fill is a plain CSS
// transition and the trigger is a timer: no requestAnimationFrame, because a
// tab that is not compositing never runs one and the hold could never finish.
const HOLD_MS = 700;
(function wireHold() {
  const btn = $('btnFlash');
  let timer = null;

  function reset() {
    if (timer) { clearTimeout(timer); timer = null; }
    btn.style.setProperty('--hold-dur', '140ms');
    btn.style.setProperty('--hold', '0');
  }

  function begin(e) {
    if (btn.disabled || flashing || timer) return;
    if (e.cancelable) e.preventDefault();
    btn.style.setProperty('--hold-dur', HOLD_MS + 'ms');
    btn.style.setProperty('--hold', '1');
    timer = setTimeout(() => { reset(); runFlash(); }, HOLD_MS);
  }

  btn.addEventListener('pointerdown',  begin);
  btn.addEventListener('pointerup',    reset);
  btn.addEventListener('pointerleave', reset);
  btn.addEventListener('pointercancel', reset);

  // Keyboard gets the same gate: hold Enter or Space.
  btn.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' || e.repeat) return;
    begin(e);
  });
  btn.addEventListener('keyup', e => {
    if (e.key === 'Enter' || e.key === ' ') reset();
  });
  btn.addEventListener('blur', reset);
})();

// ---- Device leaving on its own -------------------------------------------
if ('usb' in navigator) {
  navigator.usb.addEventListener('disconnect', ev => {
    if (device && ev.device === device) {
      device = null;
      if (flashing) {
        log('device disconnected mid-flash. the image is incomplete, redo it.', 'err');
        setStatus('Disconnected', 'error');
      } else if (step < 4) {
        log('device disconnected');
        setStatus('No device', 'idle');
      }
      $('btnFlash').disabled = true;
    }
  });
} else {
  log('no WebUSB here. use Chrome or Edge, or the dfu-programmer route in Files.', 'err');
  $('btnConnect').disabled = true;
  setStatus('No WebUSB', 'error');
}

window.addEventListener('beforeunload', ev => {
  if (flashing) { ev.preventDefault(); ev.returnValue = ''; }
});
