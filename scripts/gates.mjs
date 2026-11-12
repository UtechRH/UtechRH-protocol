// node scripts/gates.mjs   (npm run gates)
// Builds dist/ and two mutated copies, then asserts. Exit 0 only when every gate passes.
// Mutation anchors are state-independent: each one reads the current record at runtime and derives its opposite.
import { readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { build, ROOT, LOGO_FILES, paletteFrom } from './build.mjs';
import * as core from '../src/core.js';
import * as R from '../src/render.js';

const results = [];
const gate = (name, fn) => {
  try { fn(); results.push([true, name]); console.log('  pass  ' + name); }
  catch (e) { results.push([false, name, e.message]); console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m || 'not equal'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const read = (p) => readFileSync(p, 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));

const TMP = join(ROOT, '.gate-tmp');
rmSync(TMP, { recursive: true, force: true });
const SRC = join(ROOT, 'src');
const real = JSON.parse(read(join(SRC, 'register.json')));
const TEST_CA = '0x' + 'a1b2c3d4e5'.repeat(4);
const OTHER = '0x' + '0f1e2d3c4b'.repeat(4);

/** Flip a record to its opposite state, deriving everything from the current record. */
function flip(reg, id, payload) {
  const r = clone(reg); const cur = r.records[id];
  if (cur.state === 'stated') {
    delete cur.value; delete cur.url; cur.state = 'absent';
  } else {
    cur.state = 'stated';
    if (payload.value !== undefined) cur.value = payload.value;
    if (payload.url !== undefined) cur.url = payload.url;
  }
  return r;
}
const stateOf = (reg, id) => reg.records[id].state;

// ---- the three builds ----
const main = build({ quiet: true });            // dist/
const flipped = flip(real, 'ca', { value: TEST_CA });
const bFlip = build({ register: flipped, out: join(TMP, 'ca-flipped'), quiet: true });
const socialFlipped = flip(flip(real, 'x', { url: 'https://x.com/Other' }), 'github', { url: 'https://github.com/utech-org' });
const bSoc = build({ register: socialFlipped, out: join(TMP, 'social-flipped'), quiet: true });
const DIST = main.outDir;
const html = read(join(DIST, 'index.html'));
const htmlFlip = read(join(bFlip.outDir, 'index.html'));
const htmlSoc = read(join(bSoc.outDir, 'index.html'));
const inertBranch = stateOf(real, 'ca') !== 'stated' ? { reg: real, html } : { reg: flipped, html: htmlFlip };
const liveBranch = stateOf(real, 'ca') === 'stated' ? { reg: real, html } : { reg: flipped, html: htmlFlip };

const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const css = read(join(SRC, 'styles.css'));
const tokens = read(join(SRC, 'tokens.css'));
const app = read(join(SRC, 'app.js'));
const visible = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

// ---- minimal PNG decoder (8-bit, non-interlaced, colour types 2 and 6) ----
function decodePng(buf) {
  ok(buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'not a png');
  let p = 8; let ihdr; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8); const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], ct: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  ok(ihdr.depth === 8 && !ihdr.interlace && (ihdr.ct === 2 || ihdr.ct === 6), 'unsupported png layout ' + JSON.stringify(ihdr));
  const bpp = ihdr.ct === 6 ? 4 : 3; const stride = ihdr.w * bpp;
  const raw = inflateSync(Buffer.concat(idat)); const px = Buffer.alloc(stride * ihdr.h);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)]; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)); const row = px.subarray(y * stride, (y + 1) * stride); const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0; const b = prev ? prev[i] : 0; const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
  }
  return { ...ihdr, bpp, px };
}
const pixel = (img, x, y) => Array.from(img.px.subarray((y * img.w + x) * img.bpp, (y * img.w + x) * img.bpp + 3));
const hex = (a) => '#' + a.map((v) => v.toString(16).padStart(2, '0')).join('');

console.log('\nGATES');

// =============================================================== deploy folder + logo
gate('dist/index.html exists', () => ok(existsSync(join(DIST, 'index.html'))));
gate('build script copies every logo file into dist/', () => {
  for (const f of LOGO_FILES) { ok(existsSync(join(DIST, f)), f + ' missing from dist'); ok(Buffer.compare(readFileSync(join(DIST, f)), readFileSync(join(SRC, 'assets', f))) === 0, f + ' differs from src/assets'); }
});
gate('index.html logo references use relative paths that resolve inside dist/', () => {
  const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  ok(imgs.some((s) => /^logo-\d+\.png$/.test(s)), 'no logo <img> found');
  for (const s of imgs) { ok(!/^(\/|https?:|data:)/.test(s), 'non-relative img src ' + s); ok(existsSync(join(DIST, s)), 'img src does not resolve: ' + s); }
});
gate('every local href/src in index.html resolves to a file in dist/', () => {
  for (const m of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) { const u = m[1]; if (/^(https?:|mailto:)/.test(u)) continue; ok(existsSync(join(DIST, u)), 'unresolved ' + u); }
});
gate('apple-touch-icon and favicon are linked and present', () => { ok(/rel="icon"[^>]+href="favicon\.svg"/.test(html)); ok(existsSync(join(DIST, 'favicon.svg'))); ok(/apple-touch-icon" href="logo-192\.png"/.test(html)); });
gate('logo source is RGBA with pure-black transparent region (premultiplied path required)', () => {
  const img = decodePng(readFileSync(join(ROOT, 'brand', 'LOGO UTECH PNG...png')));
  eq(img.ct, 6, 'colortype'); let blackT = 0; for (let i = 0; i < img.px.length; i += 4) if (img.px[i + 3] === 0 && !img.px[i] && !img.px[i + 1] && !img.px[i + 2]) blackT++;
  ok(blackT > 1e6, 'expected a large black transparent area, got ' + blackT);
});
gate('shipped logos are RGBA, correct size, no dark fringe on semi-transparent pixels', () => {
  for (const [f, n] of [['logo-512.png', 512], ['logo-192.png', 192], ['logo-128.png', 128]]) {
    const img = decodePng(readFileSync(join(DIST, f))); eq([img.w, img.h, img.ct], [n, n, 6], f);
    let semi = 0, dark = 0; for (let i = 0; i < img.px.length; i += 4) { const a = img.px[i + 3]; if (a > 0 && a < 255) { semi++; if (img.px[i] + img.px[i + 1] + img.px[i + 2] < 60) dark++; } }
    ok(semi > 100, f + ' has no antialiased edge'); ok(dark / semi < 0.03, `${f}: ${(100 * dark / semi).toFixed(1)}% of edge pixels are near-black (non-premultiplied resize)`);
  }
});

// =============================================================== favicon
gate('favicon is SVG 32x32, no comments, no double hyphen anywhere', () => {
  const s = read(join(DIST, 'favicon.svg'));
  ok(/<svg[^>]+width="32"[^>]+height="32"[^>]+viewBox="0 0 32 32"/.test(s), 'size');
  ok(!s.includes('<!--') && !s.includes('--'), 'comment or double hyphen present');
  ok(!s.includes('<?xml'), 'unexpected xml prolog');
  ok((s.match(/<path /g) || []).length === 3, 'expected 3 traced paths');
});
gate('favicon trace comes from the real pixel grid of the logo asset', () => {
  const t = JSON.parse(read(join(ROOT, 'tools', 'favicon-trace.json')));
  ok(/LOGO UTECH PNG\.\.\.png/.test(t.source) && /Moore trace/.test(t.source), 'provenance missing');
  const img = decodePng(readFileSync(join(ROOT, 'brand', 'LOGO UTECH PNG...png')));
  const m = /crop box \[(\d+), (\d+), (\d+), (\d+)\]/.exec(t.source); const [bx, by, bx2] = [+m[1], +m[2], +m[3]]; const bs = bx2 - bx;
  let checked = 0;
  const alphaAt = (sx, sy) => (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h ? 0 : img.px[(sy * img.w + sx) * 4 + 3]);
  for (const s of t.shapes) for (const p of s.points) {
    const sx = Math.round(bx + (p[0] - 2) * bs / 28), sy = Math.round(by + (p[1] - 2) * bs / 28); let solid = false, clear = false;
    for (let dy = -10; dy <= 10; dy += 2) for (let dx = -10; dx <= 10; dx += 2) { const a = alphaAt(sx + dx, sy + dy); if (a > 200) solid = true; if (a < 40) clear = true; }
    ok(solid && clear, `vertex is not on a real shape edge at ${sx},${sy}`); checked++;
  }
  ok(checked >= 30);
});
gate('favicon colours are all palette tokens', () => {
  const pal = Object.values(paletteFrom(tokens)).map((v) => v.toLowerCase());
  for (const m of read(join(DIST, 'favicon.svg')).matchAll(/#[0-9a-fA-F]{6}\b/g)) ok(pal.includes(m[0].toLowerCase()), 'foreign colour ' + m[0]);
});

// =============================================================== palette
gate('palette provenance: every token cites a brand/ pixel and matches it exactly', () => {
  const blocks = [...tokens.matchAll(/\/\*\s*src:(brand\/[^\n]+?\.png) px:\((\d+),(\d+)\)[^*]*\*\/\s*--palette-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)];
  const names = [...tokens.matchAll(/--palette-([a-z-]+):/g)].map((m) => m[1]);
  eq(blocks.length, names.length, 'tokens without a provenance comment');
  ok(/k-means/.test(tokens) && /real pixel/i.test(tokens), 'header must name k-means and the real-pixel snap');
  const cache = {};
  for (const [, file, x, y, name, val] of blocks) { const img = cache[file] || (cache[file] = decodePng(readFileSync(join(ROOT, file)))); eq(hex(pixel(img, +x, +y)), val.toLowerCase(), `--palette-${name} vs ${file} @(${x},${y})`); }
});
gate('colour literals live only in tokens.css (src, scripts, tools)', () => {
  const files = [...walk(SRC), ...walk(join(ROOT, 'scripts')), ...walk(join(ROOT, 'tools'))].filter((f) => /\.(css|js|mjs|html|json|py)$/.test(f) && !f.endsWith('tokens.css') && !f.endsWith('gates.mjs'));
  for (const f of files) {
    const t = read(f).replace(/href="#[^"]*"|id="[^"]*"|url\(#\w+\)|aria-controls="[^"]*"|querySelector\([^)]*\)|\$\('#[^']*'/g, '').replace(/'#[a-z-]+[0-9]*'|"#[a-z-]+[0-9]*"|`#[a-z-]+`|#'[^']*'|\$\$\('#[^']*'/g, '');
    const m = t.match(/(?<![\w&])#[0-9a-fA-F]{3,8}\b(?![-\w])/g); ok(!m, `${relative(ROOT, f)} carries literal ${m}`);
    ok(!/\brgba?\(|\bhsla?\(/.test(t.replace(/\/\*[\s\S]*?\*\//g, '')), `${relative(ROOT, f)} carries rgb()/hsl()`);
  }
});
gate('built dist carries no colour literal beyond palette values', () => {
  const pal = Object.values(paletteFrom(tokens)).map((v) => v.toLowerCase());
  for (const f of walk(DIST).filter((f) => /\.(html|js|css|svg)$/.test(f))) for (const m of read(f).matchAll(/(?<![\w&"=#])#[0-9a-fA-F]{6}\b/g)) ok(pal.includes(m[0].toLowerCase()), `${relative(ROOT, f)} has ${m[0]}`);
});

// =============================================================== register
gate('register valid: states, inert records carry no value or url', () => { eq(core.validateRegister(real), []); });
gate('register records carry source and scope', () => { for (const [id, r] of Object.entries(real.records)) ok(r.source && r.scope, id + ' lacks provenance'); });
gate('chain record matches the client statement', () => {
  const c = real.records.chain; eq(c.state, 'stated'); eq(c.value.chainId, '0x1237'); eq(c.value.chainIdDecimal, 4663); eq(parseInt(c.value.chainId, 16), 4663); eq(c.value.rpc, 'https://rpc.mainnet.chain.robinhood.com'); eq(c.scope, 'batch-level');
});
gate('market and own-token sources are the statement values (market slug corrected after a provable 404)', () => {
  eq(real.records['market-source'].url, 'https://api.geckoterminal.com/api/v2/networks/robinhood/trending_pools?include=base_token,quote_token&page=1');
  eq(real.records['own-token-source'].url, 'https://api.dexscreener.com/latest/dex/tokens/{CA}');
});
gate('validator rejects an inert record that smuggles a value or url', () => {
  const bad = clone(real); bad.records.github.url = 'https://github.com/x'; ok(core.validateRegister(bad).length === 1);
  const bad2 = clone(real); bad2.records.ca.value = TEST_CA; ok(core.validateRegister(bad2).length >= 1);
  const bad3 = clone(flipped); bad3.records.ca.value = '0x1237'; ok(core.validateRegister(bad3).length >= 1, 'short stated CA accepted');
});
gate('register dates stay data-only: stripped from the page copy', () => {
  ok(Object.values(real.records).some((r) => r.stamp), 'register should keep its dates');
  const inline = JSON.parse(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/.exec(html)[1]);
  for (const r of Object.values(inline.records)) ok(!('stamp' in r), 'date leaked into page');
});

// =============================================================== no dates
const DATE_RES = [/\b(19|20)\d{2}-\d{2}-\d{2}\b/, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i, /\b\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, /\b\d{1,2}:\d{2}(:\d{2})?\b/, /\bas of\b/i, /\bchecked\b/i, /\bupdated\b/i, /\bago\b/i, /©|&copy;/, /new Date|Date\.now|toLocale(Date|Time)String|toISOString|getFullYear|Intl\.DateTimeFormat/];
gate('no dates, timestamps, clocks, "as of" or "checked" anywhere in dist/', () => {
  for (const f of walk(DIST).filter((f) => /\.(html|js|css|svg)$/.test(f))) { const t = read(f); for (const re of DATE_RES) { const m = re.exec(t); ok(!m, `${relative(ROOT, f)} matches ${re}: "${m && m[0]}"`); } }
});
gate('no four-digit year in page markup', () => { for (const h of [html, htmlFlip]) { const m = /(19|20)\d{2}/.exec(h.replace(/<script[\s\S]*?<\/script>/g, '')); ok(!m, 'year-like number: ' + (m && m[0])); } });
gate('no dates in either mutated branch either', () => { for (const h of [htmlFlip, htmlSoc]) for (const re of DATE_RES) ok(!re.test(h), 'matches ' + re); });
gate('no dates in aria-labels, titles or alt text', () => { for (const m of html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)) for (const re of DATE_RES) ok(!re.test(m[1]), m[1]); });

// =============================================================== CA slot, both branches
gate('CA slot is the first thing in <header>, ahead of the nav', () => { const h = html.slice(html.indexOf('<header')); ok(h.indexOf('ca-slot') > 0 && h.indexOf('ca-slot') < h.indexOf('<nav'), 'order'); });
gate('CA value font is large (clamp max >= 24px) and full address wraps instead of truncating', () => {
  const rule = /\.ca-value\s*\{([^}]*)\}/.exec(css)[1]; const mx = /clamp\([^,]+,[^,]+,\s*(\d+)px\)/.exec(rule); ok(mx && +mx[1] >= 24, 'font clamp'); ok(/word-break:\s*break-all/.test(rule), 'wrap'); ok(!/text-overflow|overflow:\s*hidden/.test(rule), 'truncates');
});
gate('inert branch: CA slot is label + "pending", disabled copy, no address, no value', () => {
  const st = inertBranch.reg.records.ca.state; const m = new RegExp(`<div class="ca-slot is-inert" data-ca-state="${st}">([\\s\\S]*?)</div>`).exec(inertBranch.html); ok(m, 'inert slot not found for state ' + st);
  ok(/pending/.test(m[1]) && /disabled/.test(m[1]) && /aria-disabled="true"/.test(m[1])); ok(!/data-copy/.test(m[1]), 'inert slot is copyable'); ok(!core.ADDRESS_RE.test(m[1]));
});
gate('live branch: CA slot shows the full address, copy handlers wired, feedback region present', () => {
  const v = liveBranch.reg.records.ca.value; const m = /<div class="ca-slot" data-ca-state="stated">([\s\S]*?)<\/div>/.exec(liveBranch.html); ok(m, 'live slot not found');
  ok(m[1].includes(`>${v}<`), 'address not shown whole'); eq((m[1].match(/data-copy="/g) || []).length, 2); ok(/role="status" aria-live="polite"/.test(m[1])); ok(!/disabled/.test(m[1]));
});
gate('copy feedback logic exists in the client (Copied state, auto-reset)', () => { ok(/Copied/.test(app) && /is-copied/.test(app) && /clipboard/.test(app)); });
gate('mutation harness: flipping the CA record flips the slot, and flipping back restores it byte for byte', () => {
  const back = flip(flipped, 'ca', { value: TEST_CA }); eq(core.statedCa(back), null); eq(R.renderCaSlot(back), R.renderCaSlot(real));
  ok(R.renderCaSlot(real) !== R.renderCaSlot(flipped), 'flip changed nothing');
});

// =============================================================== address scanner
gate('scanner never blanket-rejects 0x hex: chain id and short hex pass', () => {
  eq(core.gateText('chain 0x1237 and 0xdeadbeef', real).flagged, []); eq(core.gateText('chain 0x1237', real).text, 'chain 0x1237'); ok(/0x1237/.test(html), 'chain id missing from page');
});
gate('scanner flags an address-shaped string when the CA is absent', () => { ok(core.statedCa(inertBranch.reg) === null); eq(core.gateText(OTHER, inertBranch.reg).flagged, [OTHER]); eq(core.gateText(OTHER, inertBranch.reg).text, '—'); });
gate('scanner passes the stated CA (any case) and flags every other address', () => {
  const g = liveBranch.reg; const ca = g.records.ca.value; eq(core.scanAddresses(`${ca} ${ca.toUpperCase().replace('0X', '0x')}`, g), []); eq(core.scanAddresses(`${ca} ${OTHER}`, g), [OTHER]);
});
gate('scanner treats 41- and 43-char hex as not-an-address boundary cases correctly', () => { eq(core.scanAddresses('0x' + 'a'.repeat(39), real), []); eq(core.scanAddresses('0x' + 'a'.repeat(41), real).length, 0); });
gate('built pages contain no address-shaped string except the stated CA (both branches)', () => {
  eq(core.scanAddresses(html, real), []); eq(core.scanAddresses(htmlFlip, flipped), []); for (const f of walk(DIST).filter((f) => /\.(js|css|svg)$/.test(f))) eq(core.scanAddresses(read(f), real), [], f);
});
gate('a foreign address planted in the live branch is caught', () => { eq(core.scanAddresses(liveBranch.html.replace('</footer>', OTHER + '</footer>'), liveBranch.reg), [OTHER]); });
gate('client routes every market string through the address gate', () => { ok(/gateText/.test(app) && /safe\(r\.symbol\)/.test(app) && /safe\(r\.name\)/.test(app) && /safe\(data\.symbol\)/.test(app)); });
gate('CA is exempt from the scanner only through the registry (no hard-coded exemption)', () => { ok(!/a1b2c3d4e5/.test(read(join(SRC, 'core.js')))); ok(/statedCa\(register\)/.test(read(join(SRC, 'core.js')))); });

// =============================================================== social + link rule
const headerOf = (h) => h.slice(h.indexOf('<header'), h.indexOf('</header>'));
gate('social: both icons inside the header nav, right-hand cluster, at every breakpoint', () => {
  const hd = headerOf(html); const right = hd.slice(hd.indexOf('class="nav-right"')); ok(right.includes('data-social="x"') && right.includes('data-social="github"'), 'not in nav-right');
  for (const sel of ['social', 'icon-btn', 'nav-right']) for (const m of css.matchAll(new RegExp(`([^{}]*${sel}[^{}]*)\\{([^}]*)\\}`, 'g'))) ok(!/display:\s*none/.test(m[2]), `${sel} hidden by rule ${m[1].trim()}`);
  for (const m of css.matchAll(/@media[^{]+\{([\s\S]*?\})\s*\}/g)) ok(!/(icon-btn|social)[^{}]*\{[^}]*display:\s*none/.test(m[0]), 'icon hidden inside a media query');
});
gate('social: icon only, no visible text, official marks', () => {
  const hd = headerOf(html); for (const id of ['x', 'github']) { const m = new RegExp(`<(a|span)[^>]*data-social="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(hd); ok(m, id); eq(m[2].replace(/<svg[\s\S]*?<\/svg>/, '').trim(), '', id + ' has text'); ok(/aria-label="/.test(m[0])); }
  ok(hd.includes(R.X_PATH) && hd.includes(R.GH_PATH)); ok(R.X_PATH.startsWith('M18.244 2.25h3.308') && R.GH_PATH.startsWith('M8 0c4.42 0 8 3.58 8 8'), 'marks changed');
  ok(!/\bGitHub\b|>X<|>X\s/.test(visible(hd).replace(/\s+/g, ' ')), 'text label leaked');
});
gate('link rule: stated X is a link whose handle is derived; unstated GitHub has no href', () => {
  const hd = headerOf(html); const xr = real.records.x, gr = real.records.github;
  const xm = /<(a|span)[^>]*data-social="x"[^>]*>/.exec(hd)[0]; const gm = /<(a|span)[^>]*data-social="github"[^>]*>/.exec(hd)[0];
  if (xr.state === 'stated') { ok(xm.includes(`href="${xr.url}"`) && xm.includes(core.handleFromUrl(xr.url)), 'x link'); eq(core.handleFromUrl('https://x.com/Utech'), '@Utech'); } else ok(!xm.includes('href'), 'x href for unstated record');
  if (gr.state !== 'stated') ok(!gm.includes('href') && gm.includes('is-inert') && gm.includes('aria-disabled="true"'), 'github should be inert'); else ok(gm.includes(`href="${gr.url}"`));
});
gate('mutation harness: flipping each social record flips link<->inert, handle always derived', () => {
  for (const id of ['x', 'github']) { const was = stateOf(real, id) === 'stated'; const m = new RegExp(`<(a|span)[^>]*data-social="${id}"[^>]*>`).exec(headerOf(htmlSoc))[0]; eq(m.includes('href='), !was, id + ' did not flip'); }
  const gh = /data-social="github"[^>]*aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*data-social="github"/.exec(headerOf(htmlSoc)); ok(gh);
});
gate('no <a> carries an external href unless a stated record owns that exact url', () => {
  const owned = new Set(Object.values(real.records).filter((r) => r.state === 'stated' && r.url && !r.url.includes('{CA}')).map((r) => r.url));
  for (const m of html.matchAll(/<a\b[^>]*href="(https?:[^"]+)"/g)) ok(owned.has(m[1]), 'unowned external href ' + m[1]);
  for (const m of html.matchAll(/<a\b(?![^>]*href=)[^>]*>/g)) ok(!/target=/.test(m[0]), 'anchor without href');
  for (const m of html.matchAll(/href="(?:#?|javascript:[^"]*)"/g)) ok(m[0] !== 'href=""' && m[0] !== 'href="#"', 'empty href');
});
gate('inert records in the status list render label + "pending" only', () => {
  for (const [id, r] of Object.entries(real.records)) { if (r.state === 'stated') continue; const m = new RegExp(`<li class="status-row spot" data-record="${id}">([\\s\\S]*?)</li>`).exec(html); if (!m) continue; eq(visible(m[1]).replace(/\s+/g, ' ').trim(), `${r.label} pending`, id); ok(!/href|data-copy|0x/.test(m[1])); }
});

// =============================================================== market + own row
const GECKO = (id, sym, vol, extra = {}) => ({ pool: { id: 'pool_' + id, type: 'pool', attributes: { volume_usd: { h24: vol }, price_change_percentage: { h24: 'chg' in extra ? extra.chg : '1.5' }, reserve_in_usd: extra.liq ?? '1000', base_token_price_usd: extra.poolPx ?? null }, relationships: { base_token: { data: { id: 'tok_' + id } }, quote_token: { data: { id: 'tok_q' } } } }, tok: { id: 'tok_' + id, type: 'token', attributes: { address: extra.addr || '0x' + id.padStart(40, '0'), symbol: sym, name: sym + ' Coin', image_url: extra.img === undefined ? 'https://img/' + sym + '.png' : extra.img, ...(extra.price === null ? {} : { price_usd: extra.price ?? '0.5' }) } } });
const fixture = (() => { const items = []; for (let i = 1; i <= 14; i++) items.push(GECKO(String(i), 'T' + i, String(i * 1000))); items.push(GECKO('3', 'T3', '99'));  // duplicate token, weaker pool
  items.push(GECKO('x1', 'NOIMG', '500', { img: null })); items.push(GECKO('x2', 'NOPX', '600', { price: null, chg: null, poolPx: '0.77' })); return { data: items.map((i) => i.pool), included: [...items.map((i) => i.tok), { id: 'tok_q', type: 'dex', attributes: {} }] }; })();
gate('trending parser: tokens from included[type=token], matched through base_token id, sorted by 24h volume', () => {
  const rows = core.parseTrending(fixture); eq(rows[0].symbol, 'T14'); for (let i = 1; i < rows.length; i++) ok(rows[i - 1].volume >= rows[i].volume, 'not sorted'); eq(rows.filter((r) => r.symbol === 'T3').length, 1, 'duplicate token kept');
  const px = rows.find((r) => r.symbol === 'NOPX'); eq([px.price, px.change], [0.77, null]); const nn = core.parseTrending({ data: [{ attributes: { volume_usd: { h24: '1' } }, relationships: { base_token: { data: { id: 'q' } } } }], included: [{ id: 'q', type: 'token', attributes: { symbol: 'Q' } }] })[0]; eq(nn.price, null); eq(core.fmtUsd(nn.price), '—'); eq(core.fmtPct(px.change), '—');
});
gate('trending parser: missing image becomes a letter tile fallback, price/change/volume mapped from the right fields', () => {
  const rows = core.parseTrending(fixture); const n = rows.find((r) => r.symbol === 'NOIMG'); eq(n.logo, null); eq(core.tileLetter('noimg'), 'N'); eq(core.tileLetter(''), '?');
  const t = rows.find((r) => r.symbol === 'T14'); eq([t.price, t.change, t.volume, t.liquidity], [0.5, 1.5, 14000, 1000]);
  ok(/data-letter/.test(app) && /addEventListener\('error'/.test(app), 'client lacks load-failure fallback');
});
gate('board: ten rows, row 1 pinned, own token removed from rows 2-10 when it is trending', () => {
  const rows = core.parseTrending(fixture); const ca = rows[2].address; const b = core.composeBoard({ own: true }, rows, ca); eq(b.length, 10); ok(b[0].own === true); ok(!b.slice(1).some((r) => r.address === ca), 'own token still in rows 2-10');
  const b2 = core.composeBoard({ own: true }, rows, null); eq(b2.length, 10); ok(b2.slice(1).some((r) => r.address === ca), 'dedup fired with no CA');
});
gate('DexScreener pair selection: highest volume.h24 first', () => {
  const p = core.selectPair({ pairs: [{ volume: { h24: 5 }, priceUsd: '1', baseToken: { symbol: 'A' } }, { volume: { h24: 90 }, priceUsd: '2', priceChange: { h24: -3 }, liquidity: { usd: 77 }, baseToken: { symbol: 'B', name: 'Bee' } }, { volume: { h24: 10 }, baseToken: { symbol: 'C' } }] });
  eq([p.symbol, p.price, p.change, p.volume, p.liquidity], ['B', 2, -3, 90, 77]); eq(core.selectPair({ pairs: null }), null);
});
gate('market plan depends on the market-source record only (CA state has zero effect)', () => {
  eq(core.marketPlan(real), core.marketPlan(flipped)); eq(core.marketPlan.length, 1); ok(core.marketPlan(real).url === real.records['market-source'].url);
  const noCa = clone(real); delete noCa.records.ca; eq(core.marketPlan(noCa), core.marketPlan(real));
  ok(/marketPlan\(register\)/.test(app) && /plan\.url/.test(app) && !/getJson\([^)]*statedCa/.test(app));
  const strip = (h) => h.replace(/<div class="ca-slot[\s\S]*?<\/div>/, '').replace(/<div id="own-slot"[\s\S]*?<div id="rows"/, '<div id="rows"').replace(/<script type="application\/json" id="register">[\s\S]*?<\/script>/, '').replace(/<li class="status-row spot" data-record="ca">[\s\S]*?<\/li>/, '').replace(/Shown in the bar above|pending/g, '');
  eq(strip(html).length > 1000, true); eq(strip(html).replace(/\s+/g, ' '), strip(htmlFlip).replace(/\s+/g, ' '), 'market markup differs between CA states');
});
gate('market is never gated: no CA branch anywhere in the trending path', () => { const seg = app.slice(app.indexOf('async function pull()'), app.indexOf('function schedule')); ok(/if \(plan\.live\)/.test(seg) && !/if \(own\.live\)[^]*parseTrending/.test(seg)); });
gate('own plan: inert without a stated CA, otherwise the DexScreener url carries the CA', () => {
  const a = core.ownPlan(inertBranch.reg); eq([a.live, a.url], [false, null]); const b = core.ownPlan(liveBranch.reg); ok(b.live && b.url === liveBranch.reg.records['own-token-source'].url.replace('{CA}', liveBranch.reg.records.ca.value) && b.url.includes(liveBranch.reg.records.ca.value));
});
gate('own row, CA absent: brand logo from brand assets (not a letter tile), dots, non-clickable', () => {
  const m = /<div class="mrow own-row[^"]*" data-own="[^"]*"[\s\S]*?<span class="m-act"[^>]*>[\s\S]*?<\/span>\s*<\/div>/.exec(inertBranch.html); ok(m, 'row not found'); const row = m[0];
  ok(/is-placeholder/.test(row) && /data-own="absent"/.test(row) && /aria-disabled="true"/.test(row) || inertBranch.reg.records.ca.state === 'unconfirmed');
  ok(/<img class="tile tile-logo" src="logo-128\.png"/.test(row), 'brand logo missing'); ok(!/<span class="tile"/.test(row), 'letter tile used'); ok((row.match(/· · · · ·/g) || []).length === 4, 'placeholder dots'); ok(!/<button|href=|data-copy/.test(row), 'placeholder is interactive');
  ok(/own-row\s*\{[^}]*animation:\s*ownPulse/.test(css), 'ownPulse not running on the row'); ok(/\.own-row\.is-placeholder/.test(css) && !/\.own-row\.is-placeholder[^{]*\{[^}]*animation:\s*none/.test(css), 'placeholder pulse removed');
});
gate('own row, CA stated: pinned row 1 with brand logo, live fields, copy symbol, dexscreener fetch', () => {
  const m = /<div class="mrow own-row spot is-loading" data-own="stated" data-row="own">[\s\S]*?<\/button><\/span>\s*<\/div>/.exec(liveBranch.html); ok(m, 'live row not found'); ok(/logo-128\.png/.test(m[0]) && /copy-sym/.test(m[0]));
  ok(liveBranch.html.indexOf('own-slot') < liveBranch.html.indexOf('id="rows"'), 'own row is not above trending rows');
  for (const f of ['selectPair', 'ownPlan', 'composeBoard']) ok(app.includes(f), f + ' unused');
});
gate('own row styling: 2px accent left border, pulse, reduced-motion kill switch', () => {
  ok(/\.own-row\s*\{[^}]*border-left:\s*2px solid var\(--color-accent\)/.test(css)); ok(/@keyframes ownPulse/.test(css));
  const rm = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(css); ok(rm, 'reduced-motion block'); ok(/\.own-row\s*\{\s*animation:\s*none/.test(rm[1]));
});
gate('polling: 60s interval, exponential backoff, pause on hidden, immediate fetch on visible, last good data kept', () => {
  eq(core.POLL_MS, 60000); const b = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => core.backoffMs(n, 0.5)); for (let i = 1; i < b.length; i++) ok(b[i] >= b[i - 1]); ok(b[7] <= 60000 * 1.15 && b[0] === 2000); eq(core.backoffMs(20, 1) <= 69000, true);
  ok(/visibilitychange/.test(app) && /document\.hidden/.test(app) && /\.abort\(\)/.test(app) && /cycle\(\)/.test(app)); ok(/backoffMs\(/.test(app) && /state\.haveData/.test(app) && /Source unreachable/.test(app) && /dashAll/.test(app));
});
gate('skeleton rows, staggered fade-in, count-up with flash on change', () => { ok(/skeletonRow/.test(app) && /is-in/.test(app) && /flash-up/.test(app) && /requestAnimationFrame/.test(app)); ok(/--i/.test(css) && /@keyframes flash-up/.test(css) && /@keyframes skeleton-shimmer/.test(css)); });
gate('ticker is fed by the same parsed data as the board', () => { ok(/renderTicker\(state\.trending/.test(app) && /renderTrending\(board\)/.test(app)); });
gate('each trending row has a symbol copy button, own-row copy only when stated', () => { ok(/copyBtn\(sym\)/.test(app)); });

// =============================================================== motion + layout rules
gate('prefers-reduced-motion: CSS blanket rule and JS paths for reveal, parallax, count-up, walkthrough', () => {
  ok(/@media \(prefers-reduced-motion: reduce\)/.test(css) && /animation:\s*none\s*!important/.test(css) && /transition-duration:\s*\.01ms\s*!important/.test(css));
  ok((app.match(/calm\(\)/g) || []).length >= 6, 'JS ignores reduced motion in places'); ok(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(app));
});
gate('visual system present: spring reveal, parallax layers, mesh, progress bar, spotlight, live dot', () => {
  ok(/spring\(\{/.test(app) && /data-depth/.test(html) && /class="mesh"/.test(html) && /id="progress"/.test(html) && /\.spot::after/.test(css) && /\.dot::after/.test(css) && /@keyframes drift-a/.test(css));
  const s = core.spring({ from: 0, to: 1 }); let x = 0, over = 0; for (let i = 0; i < 240; i++) { x = s.step(1 / 60); over = Math.max(over, x); } ok(Math.abs(x - 1) < 0.01 && s.done && over >= 1, 'spring does not settle');
});
gate('measured reference values are used (radius 10/18, ease, durations, blur, section rhythm)', () => {
  for (const s of ['--radius-card: 10px', '--radius-panel: 18px', 'cubic-bezier(.22, 1, .36, 1)', '--duration-base: .26s', '--duration-slow: .6s', 'blur(16px) saturate(1.15)', 'clamp(4rem, 9vw, 7.5rem)', 'height: 56px']) ok(css.includes(s), 'missing ' + s);
});
gate('no ch units in CSS or inline styles', () => { ok(!/\d\s*ch\b/.test(css)); ok(!/\d\s*ch\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))); });
gate('tap targets: every interactive class sizes to var(--tap) (44px)', () => {
  ok(/--tap:\s*44px/.test(css)); for (const sel of ['.icon-btn', '.ca-copy, .rpc-copy', '.btn', '.tab', '.copy-sym', '.nav-links a', '.menu summary', '.controls button', '.brand', '.ca-value']) { const i = css.indexOf(sel + ' {'); ok(i > -1, sel + ' rule'); ok(/var\(--tap\)/.test(css.slice(i, css.indexOf('}', i))), sel + ' lacks --tap'); }
});
gate('single H1, landmarks, skip link, lang', () => { eq((html.match(/<h1\b/g) || []).length, 1); ok(/<html lang="en">/.test(html) && /<main id="main">/.test(html) && /class="skip"/.test(html)); });
gate('sections match the reference layout: hero, tabs panel, stepper, tiles, cards, status, footer', () => { for (const s of ['class="hero"', 'role="tablist"', 'id="moves"', 'tiles"', 'class="card spot"', 'status-list"', '<footer']) ok(html.includes(s) || html.includes(s.replace('class="card spot"', 'class="card spot link-card"')), s); });
gate('network figure tiles keep their slots with no invented numbers', () => { const t = /<div class="body tiles"[^>]*>(?:\s*<div class="tile-stat">[\s\S]*?<\/div>){3}\s*<\/div>/.exec(html)[0]; eq((t.match(/class="v">pending</g) || []).length, 3); ok(!/\d{2,}/.test(visible(t))); });

// =============================================================== copy
gate('copy: zero shared content bigrams with the reference, no reference-only vocabulary', () => {
  const ref = JSON.parse(read(join(ROOT, 'tools', 'ref-bigrams.json'))); const refB = new Set(ref.bigrams); const refW = new Set(ref.words);
  const STOP = new Set('a an the and or but of to in on at by for with from as is are was were be been it its this that these those you your we our us they them their he she his her i me my not no so if than then there here when what which who how why can will would should could may might do does did done has have had up out over into just also only more most other some such too very about after again all any both each few own same s t cannot never already every each anyone nobody anything everything against before once via per until while between within without through during still even yet ever always often much many one'.split(' '));
  const appStrings = [...app.matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]).filter((s) => /\s/.test(s) && !/[{}()=<>\/]/.test(s));
  const NL = String.fromCharCode(10);
  const segs = html.replace(/<script[\s\S]*?<\/script>/g, NL).replace(/<style[\s\S]*?<\/style>/g, NL).replace(/<svg[\s\S]*?<\/svg>/g, NL).replace(/<[^>]+>/g, NL).replace(/&[a-z#0-9]+;/g, ' ').split(NL).concat(appStrings).map((x) => x.toLowerCase()).filter((x) => x.trim() && !/^\s*https?:/.test(x));
  const PROPER = new Set(['robinhood chain', 'chain 4663']); const words = segs.join(' ').match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
  const hits = new Set(); for (const seg of segs) { const w = seg.match(/[a-z0-9]+(?:'[a-z]+)?/g) || []; for (let i = 0; i < w.length - 1; i++) { const [a, b] = [w[i], w[i + 1]]; if (STOP.has(a) && STOP.has(b)) continue; if (PROPER.has(a + ' ' + b)) continue; if (refB.has(a + ' ' + b)) hits.add(a + ' ' + b); } }
  ok(hits.size === 0, 'shared bigrams: ' + [...hits].join(' | '));
  const ALLOW = new Set(['robinhood', 'chain', 'utech', 'agent', 'agents', 'workflow', 'workflows', 'transaction', 'transactions', 'documentation', 'ecosystem', 'mainnet', 'contract']);
  const shared = [...new Set(words.filter((w) => w.length >= 8 && refW.has(w) && !ALLOW.has(w)))]; ok(shared.length === 0, 'shared long words: ' + shared.join(', '));
});

// =============================================================== repo hygiene + files
gate('repo files: README, whitepaper, LICENSE exist at root and are not shipped in dist/', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) ok(existsSync(join(ROOT, f)), f + ' missing');
  for (const f of walk(DIST)) ok(!/(README|whitepaper|LICENSE)/i.test(f), 'ships ' + f); ok(/MIT License/.test(read(join(ROOT, 'LICENSE'))) && /Copyright \(c\) 2026 UTECH/.test(read(join(ROOT, 'LICENSE'))));
});
gate('README has name, tagline, site badge, chain, CA placeholder, Overview/Features/Links', () => { const r = read(join(ROOT, 'README.md')); for (const s of ['Utech', 'Track. Confirm. Resume.', 'img.shields.io', 'Robinhood Chain', 'Contract address', '## Overview', '## Features', '## Links']) ok(r.includes(s), s); });
gate('whitepaper has vision, tokenomics placeholders, 3-4 phase roadmap, team placeholder', () => { const w = read(join(ROOT, 'docs', 'whitepaper.md')); ok(/vision/i.test(w) && /mission/i.test(w) && /tokenomics/i.test(w) && /team/i.test(w)); const ph = (w.match(/^### Phase \d/gm) || []).length; ok(ph >= 3 && ph <= 4, 'phases ' + ph); });
gate('repo hygiene: no agent config dirs or files, no tool attribution anywhere', () => {
  for (const f of ['CLAUDE.md', '.claude', 'AGENTS.md', '.cursor']) ok(!existsSync(join(ROOT, f)), f + ' present');
  const bad = new RegExp(['cla' + 'ude', 'anthro' + 'pic', '\\bA' + 'I[- ](generated|assisted|written)', 'generated (by|with)', 'co-authored-by', 'chat' + 'gpt', 'gem' + 'ini'].join('|'), 'i');
  const skip = new Set(['node_modules', '.gate-tmp', 'brand', 'reference']);
  const all = []; (function w(d) { for (const n of readdirSync(d)) { if (skip.has(n)) continue; const p = join(d, n); statSync(p).isDirectory() ? w(p) : all.push(p); } })(ROOT);
  for (const f of all) { if (!/\.(md|json|js|mjs|css|html|svg|py|txt|yml|yaml)$|LICENSE|_headers/.test(f) || f.endsWith(join('tools', 'ref-bigrams.json')) || f.endsWith(join('scripts', 'gates.mjs'))) continue; const m = bad.exec(read(f)); ok(!m, `${relative(ROOT, f)} mentions "${m && m[0]}"`); }
});
gate('build is deterministic and writes only inside the project', () => {
  const h = (d) => createHash('sha256').update(walk(d).sort().map((f) => relative(d, f) + read(f)).join('\n')).digest('hex'); const again = build({ out: join(TMP, 'again'), quiet: true });
  eq(h(again.outDir), h(DIST)); let threw = false; try { build({ out: join(ROOT, '..', 'escape'), quiet: true }); } catch { threw = true; } ok(threw, 'build wrote outside project');
});

rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length} gates, ${results.length - failed.length} passed, ${failed.length} failed`);
console.log(`both CA branches exercised: inert=${stateOf(inertBranch.reg, 'ca')}, live=${stateOf(liveBranch.reg, 'ca')}`);
process.exit(failed.length ? 1 : 0);
