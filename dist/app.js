import {
  rec, isStated, statedCa, gateText, marketPlan, ownPlan, parseTrending, selectPair, composeBoard,
  backoffMs, POLL_MS, BOARD_SIZE, DASH, fmtUsd, fmtCompact, fmtPct, tileLetter, spring,
} from './core.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => reduced.matches;

let register = { records: {} };
try { register = JSON.parse($('#register').textContent); } catch { /* page still renders, every slot stays inert */ }

/* ------------------------------------------------------------------ copy */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((res, rej) => {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } finally { t.remove(); }
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b || b.disabled) return;
  const slot = b.closest('.ca-slot');
  copyText(b.dataset.copy).then(() => {
    b.classList.add('is-copied');
    if (slot) {
      slot.classList.add('is-copied');
      const fb = $('.ca-feedback', slot); if (fb) fb.textContent = 'Copied';
      const tx = $('.ca-copy-text', slot); if (tx) tx.textContent = 'Copied';
      setTimeout(() => { slot.classList.remove('is-copied'); if (fb) fb.textContent = ''; if (tx) tx.textContent = 'Copy'; b.classList.remove('is-copied'); }, 1600);
    } else {
      b.setAttribute('aria-label', 'Copied');
      setTimeout(() => { b.classList.remove('is-copied'); b.setAttribute('aria-label', b.dataset.label || 'Copy'); }, 1300);
    }
  }).catch(() => {
    const fb = slot && $('.ca-feedback', slot); if (fb) { fb.textContent = 'Select and copy'; setTimeout(() => (fb.textContent = ''), 2000); }
  });
});

/* ------------------------------------------------------------------ menu */
const menu = $('#menu');
if (menu) {
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) menu.open = false; });
  document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
}

/* ------------------------------------------------------------------ scroll progress, parallax, spotlight */
const bar = $('#progress');
const layers = $$('[data-depth]');
const stage = $('#orbital-stage');
let tx = 0, ty = 0, cx = 0, cy = 0, sy = 0, raf = 0;
function frame() {
  raf = 0;
  cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
  for (const el of layers) {
    const d = parseFloat(el.dataset.depth) || 0;
    el.style.translate = `${(cx * d * 18).toFixed(2)}px ${(cy * d * 18 + sy * d * 0.05).toFixed(2)}px`;
  }
  if (stage) { stage.style.setProperty('--px', (cx * 8).toFixed(2) + 'deg'); stage.style.setProperty('--py', (-cy * 8).toFixed(2) + 'deg'); }
  if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) raf = requestAnimationFrame(frame);
}
const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
function onScroll() {
  const h = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  if (!calm() && scrollY < innerHeight * 1.4) { sy = scrollY; kick(); }
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();
if (!calm()) {
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; kick();
  }, { passive: true });
}
document.addEventListener('pointermove', (e) => {
  const s = e.target.closest && e.target.closest('.spot');
  if (!s) return;
  const r = s.getBoundingClientRect();
  s.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  s.style.setProperty('--my', (e.clientY - r.top) + 'px');
}, { passive: true });

/* ------------------------------------------------------------------ spring reveal */
const revealEls = $$('[data-reveal]');
function springIn(el, delay) {
  if (calm()) { el.style.opacity = '1'; el.style.transform = ''; return; }
  const sp = spring({ stiffness: 170, damping: 22, mass: 1, from: 0, to: 1 });
  let last = 0;
  const start = performance.now() + delay;
  el.style.willChange = 'transform, opacity';
  (function tick(now) {
    if (now < start) { requestAnimationFrame(tick); return; }
    const dt = last ? (now - last) / 1000 : 1 / 60; last = now;
    const x = sp.step(dt);
    el.style.opacity = String(Math.max(0, Math.min(1, x * 1.15)));
    el.style.transform = `translate3d(0, ${((1 - x) * 28).toFixed(2)}px, 0)`;
    if (!sp.done) requestAnimationFrame(tick);
    else { el.style.opacity = '1'; el.style.transform = ''; el.style.willChange = ''; }
  })(performance.now());
}
if ('IntersectionObserver' in window && !calm()) {
  const pending = new Set();
  const io = new IntersectionObserver((entries) => {
    const batch = entries.filter((e) => e.isIntersecting);
    batch.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    batch.forEach((en, i) => { io.unobserve(en.target); pending.delete(en.target); springIn(en.target, i * 70); });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  revealEls.forEach((el) => { pending.add(el); io.observe(el); });
  setTimeout(() => pending.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight) { io.unobserve(el); springIn(el, 0); } }), 2500);
} else {
  revealEls.forEach((el) => { el.style.opacity = '1'; });
}

/* ------------------------------------------------------------------ tabs */
(function tabs() {
  const list = $('#tabs [role=tablist]'); if (!list) return;
  const tabs = $$('[role=tab]', list);
  const select = (t, focus) => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; const p = $('#' + x.getAttribute('aria-controls')); p.hidden = !on; });
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
      if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
      if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
    });
  });
})();

/* ------------------------------------------------------------------ scripted walkthrough */
(function walkthrough() {
  const wrap = $('#moves'); if (!wrap) return;
  const N = 12;
  wrap.innerHTML = Array.from({ length: N }, (_, i) => `<li class="move"><span>${String(i + 1).padStart(2, '0')}</span><small></small></li>`).join('');
  const cells = $$('.move', wrap);
  // beats: 1-11 run, 12 stall, 13 find, 14 load, 15 look up, 16-19 resume 8..11 (move 7 already proven)
  const frames = [];
  for (let m = 1; m <= 11; m++) frames.push({ phase: 'run', at: m, done: m });
  frames.push({ phase: 'fail', at: 11, done: 11 });
  frames.push({ phase: 'find', at: 7, done: 7 });
  frames.push({ phase: 'load', at: 7, done: 7 });
  frames.push({ phase: 'recon', at: 7, done: 7 });
  for (let m = 8; m <= 12; m++) frames.push({ phase: m === 12 ? 'done' : 'run2', at: m, done: m });
  const total = frames.length;
  let i = 0, playing = !calm(), timer = 0;
  const render = () => {
    const f = frames[i];
    cells.forEach((c, k) => {
      const n = k + 1;
      c.className = 'move' + (n <= f.done ? ' done' : '') + (n === 7 && i >= 6 ? ' mark' : '') + (f.phase === 'fail' && n === f.at ? ' fail' : '') + (n === f.at ? ' now' : '');
      $('small', c).textContent = n === 7 && i >= 6 ? 'saved' : n === 9 && i >= 8 ? 'sent' : (f.phase === 'fail' && n === 11 ? '!' : '');
    });
    $('#demo-beat').textContent = `beat ${i + 1} of ${total}`;
    $('#rd-mark').textContent = i >= 6 ? 'written' : 'not written';
    $('#rd-order').textContent = i >= 8 ? (frames[i].phase === 'recon' ? 'found, skipped' : i >= 15 ? 'sent once' : 'sent once') : 'not sent';
    const ph = { run: 'run', run2: 'run', fail: 'fail', find: 'find', load: 'load', recon: 'recon', done: 'done' }[f.phase];
    $('#rd-phase').textContent = { run: 'Running', fail: 'Stalled', find: 'Finding marker', load: 'Loading and checking', recon: 'Looking up orders', done: 'Resumed' }[ph];
    $$('#phases li').forEach((li) => li.classList.toggle('on', li.dataset.p === ph || (ph === 'done' && li.dataset.p === 'done')));
    $('#d-pause').textContent = playing ? 'Pause' : 'Play';
  };
  const tick = () => { clearTimeout(timer); if (!playing) return; timer = setTimeout(() => { i = (i + 1) % total; render(); if (i === total - 1) { playing = false; render(); return; } tick(); }, 900); };
  $('#d-pause').addEventListener('click', () => { playing = !playing; render(); tick(); });
  $('#d-back').addEventListener('click', () => { playing = false; i = Math.max(0, i - 1); render(); });
  $('#d-fwd').addEventListener('click', () => { playing = false; i = Math.min(total - 1, i + 1); render(); });
  $('#d-restart').addEventListener('click', () => { i = 0; playing = !calm(); render(); tick(); });
  render();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { if (!e.isIntersecting) { clearTimeout(timer); } else tick(); }, { threshold: 0.2 }).observe(wrap);
  } else tick();
})();

/* ------------------------------------------------------------------ market */
const rowsEl = $('#rows');
const ownSlot = $('#own-slot');
const pill = { dot: $('#market-dot'), text: $('#market-pill-text'), msg: $('#market-msg') };
const plan = marketPlan(register);
const own = ownPlan(register);
const caLower = statedCa(register);
const state = { trending: [], haveData: false, ownData: null, attempt: 0, timer: 0, ctrl: null, rendered: new Map() };

const skeletonRow = (n) => `<div class="mrow is-skel" data-skel>
  <span class="m-rank">${n}</span><span class="m-token"><span class="tile skeleton"></span><span class="m-names"><span class="skeleton" style="width:60px;height:12px"></span><span class="skeleton" style="width:90px;height:10px;margin-top:4px"></span></span></span>
  <span class="m-cell skeleton"></span><span class="m-cell skeleton"></span><span class="m-cell skeleton"></span><span class="m-cell m-liq skeleton"></span><span class="m-act"></span></div>`;
rowsEl.innerHTML = Array.from({ length: BOARD_SIZE - 1 }, (_, k) => skeletonRow(k + 2)).join('');

function setStatus(kind, text, msg) {
  pill.dot.className = 'dot' + (kind === 'warn' ? ' is-warn' : kind === 'off' ? ' is-off' : '');
  pill.text.textContent = text;
  if (msg !== undefined) { pill.msg.textContent = msg; pill.msg.classList.toggle('err', kind !== 'live'); }
}
const safe = (s) => gateText(s, register).text;

/* number cells: count up on first paint, flash on change */
function setNum(el, value, fmt, signed) {
  const prev = el._v;
  el._v = value;
  if (value === null || value === undefined) { el.textContent = DASH; el.classList.remove('up', 'down'); return; }
  if (signed) { el.classList.toggle('up', value >= 0); el.classList.toggle('down', value < 0); }
  if (calm() || prev === value) { el.textContent = fmt(value); return; }
  if (prev !== undefined && prev !== null) {
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth;
    el.classList.add(value >= prev ? 'flash-up' : 'flash-down');
  }
  const from = prev === undefined || prev === null ? 0 : prev;
  const t0 = performance.now(); const dur = 700;
  cancelAnimationFrame(el._raf);
  (function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(from + (value - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(step); else el.textContent = fmt(value);
  })(t0);
}

function tileHtml(row) {
  const letter = tileLetter(row.symbol);
  if (row.logo) return `<img class="tile" src="${row.logo.replace(/"/g, '')}" width="36" height="36" alt="" loading="lazy" referrerpolicy="no-referrer" data-letter="${letter}">`;
  return `<span class="tile" aria-hidden="true">${letter}</span>`;
}
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.dataset.letter) { const s = document.createElement('span'); s.className = 'tile'; s.setAttribute('aria-hidden', 'true'); s.textContent = t.dataset.letter; t.replaceWith(s); }
}, true);

const copyBtn = (sym) => `<button type="button" class="copy-sym" data-copy="${sym.replace(/"/g, '')}" data-label="Copy symbol ${sym.replace(/"/g, '')}" aria-label="Copy symbol ${sym.replace(/"/g, '')}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5.75 1h6.5c.97 0 1.75.78 1.75 1.75v6.5A1.75 1.75 0 0 1 12.25 11h-6.5A1.75 1.75 0 0 1 4 9.25v-6.5C4 1.78 4.78 1 5.75 1Zm0 1.5a.25.25 0 0 0-.25.25v6.5c0 .14.11.25.25.25h6.5c.14 0 .25-.11.25-.25v-6.5a.25.25 0 0 0-.25-.25ZM2.75 5H3v1.5h-.25a.25.25 0 0 0-.25.25v6.5c0 .14.11.25.25.25h6.5a.25.25 0 0 0 .25-.25V13H10.5v.25A1.75 1.75 0 0 1 8.75 15h-6.5A1.75 1.75 0 0 1 .5 13.25v-6.5C.5 5.78 1.28 5 2.75 5Z"/></svg></button>`;

function renderTrending(rows) {
  const keys = rows.map((r) => r.key).join('|');
  const first = !rowsEl.dataset.keys;
  if (rowsEl.dataset.keys !== keys) {
    rowsEl.dataset.keys = keys;
    rowsEl.innerHTML = rows.map((r, k) => {
      const sym = safe(r.symbol) || DASH; const nm = safe(r.name) || DASH;
      return `<div class="mrow spot is-in" data-key="${r.key}" style="--i:${k}"><span class="m-rank">${k + 2}</span>
        <span class="m-token">${tileHtml({ ...r, symbol: sym })}<span class="m-names"><span class="m-sym">${sym}</span><span class="m-name">${nm}</span></span></span>
        <span class="m-cell m-price">${DASH}</span><span class="m-cell m-chg">${DASH}</span><span class="m-cell m-vol">${DASH}</span><span class="m-cell m-liq">${DASH}</span>
        <span class="m-act">${copyBtn(sym)}</span></div>`;
    }).join('');
  }
  rows.forEach((r) => {
    const el = $(`[data-key="${CSS.escape(r.key)}"]`, rowsEl); if (!el) return;
    setNum($('.m-price', el), r.price, fmtUsd);
    setNum($('.m-chg', el), r.change, fmtPct, true);
    setNum($('.m-vol', el), r.volume, fmtCompact);
    setNum($('.m-liq', el), r.liquidity, fmtCompact);
  });
  return first;
}

function renderTicker(rows) {
  const html = rows.map((r) => `<span class="tk" data-k="${r.key}"><b>${safe(r.symbol) || DASH}</b><span class="tk-p">${fmtUsd(r.price)}</span><span class="tk-c ${r.change !== null && r.change < 0 ? 'down' : 'up'}">${fmtPct(r.change)}</span></span>`).join('');
  $$('.ticker-set').forEach((s) => (s.innerHTML = html));
}

function renderOwn(data) {
  const el = $('.own-row', ownSlot);
  if (!el || el.dataset.own !== 'stated') return;
  el.classList.remove('is-loading');
  const sym = data ? safe(data.symbol) || 'UTECH' : 'UTECH';
  $('.m-sym', el).textContent = sym;
  const nm = data && data.name ? safe(data.name) : 'Utech';
  $('.m-name', el).textContent = nm;
  const btn = $('.copy-sym', el); if (btn) { btn.dataset.copy = sym; btn.dataset.label = 'Copy symbol ' + sym; btn.setAttribute('aria-label', 'Copy symbol ' + sym); }
  setNum($('.m-price', el), data ? data.price : null, fmtUsd);
  setNum($('.m-chg', el), data ? data.change : null, fmtPct, true);
  setNum($('.m-vol', el), data ? data.volume : null, fmtCompact);
  setNum($('.m-liq', el), data ? data.liquidity : null, fmtCompact);
}
const ownLogo = $('.own-row .tile-logo', ownSlot);
if (ownLogo) ownLogo.addEventListener('error', () => { const s = document.createElement('span'); s.className = 'tile'; s.textContent = 'U'; ownLogo.replaceWith(s); });

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

async function pull() {
  state.ctrl = new AbortController();
  const { signal } = state.ctrl;
  let marketOk = true;
  const jobs = [];
  if (plan.live) {
    jobs.push(getJson(plan.url, signal).then((j) => {
      const rows = parseTrending(j);
      if (!rows.length) throw new Error('empty');
      state.trending = rows; state.haveData = true;
    }).catch((e) => { if (e.name === 'AbortError') throw e; marketOk = false; }));
  }
  if (own.live) {
    jobs.push(getJson(own.url, signal).then((j) => { const p = selectPair(j); if (p) { state.ownData = p; } }).catch((e) => { if (e.name === 'AbortError') throw e; }));
  }
  await Promise.all(jobs);
  if (state.haveData) {
    const board = composeBoard({ own: true }, state.trending, caLower).slice(1);
    renderTrending(board);
    renderTicker(state.trending.slice(0, BOARD_SIZE));
    $$('[data-skel]', rowsEl).forEach((n) => n.remove());
  }
  if (own.live) renderOwn(state.ownData);
  return marketOk;
}

function schedule(ms) { clearTimeout(state.timer); state.timer = setTimeout(cycle, ms); }
async function cycle() {
  if (document.hidden) return;
  try {
    const ok = await pull();
    if (ok) {
      state.attempt = 0; setStatus('live', 'Live', 'Listings refresh every minute while this tab is open.'); schedule(POLL_MS);
    } else {
      state.attempt += 1;
      const wait = backoffMs(state.attempt - 1, Math.random());
      if (state.haveData) setStatus('warn', 'Retrying', 'Source did not answer. Showing the previous good listings.');
      else { setStatus('off', 'Source unreachable', 'The listing service is unreachable. Trying again shortly.'); dashAll(); }
      schedule(wait);
    }
  } catch (e) { /* aborted by a tab hide; the visible handler restarts the loop */ }
}
function dashAll() {
  $$('[data-skel]', rowsEl).forEach((r) => {
    r.classList.remove('is-skel');
    $$('.skeleton', r).forEach((s) => { s.classList.remove('skeleton'); if (s.classList.contains('m-cell')) s.textContent = DASH; });
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(state.timer); if (state.ctrl) state.ctrl.abort(); setStatus('off', 'Paused', undefined); }
  else { setStatus('off', 'Connecting', undefined); cycle(); }
});
if (!document.hidden) cycle();
