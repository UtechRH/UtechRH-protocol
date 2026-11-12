// node scripts/build.mjs [--register path] [--out dir]
// Zero dependencies. Output defaults to dist/, which is the folder that gets deployed.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRegister, publicRegister } from '../src/core.js';
import { renderCaSlot, renderSocial, renderChainLabel, renderStatusRows, renderHeroFacts, renderRpcCard, renderOwnRow } from '../src/render.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Every logo file the page references. The build copies each one explicitly and refuses to continue if one is missing. */
export const LOGO_FILES = ['logo-512.png', 'logo-192.png', 'logo-128.png'];
const STATIC_FILES = ['tokens.css', 'styles.css', 'app.js', 'core.js'];

export function paletteFrom(tokensCss) {
  const out = {};
  for (const m of tokensCss.matchAll(/--palette-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

export function faviconSvg(tokensCss) {
  const p = paletteFrom(tokensCss);
  const trace = JSON.parse(readFileSync(join(ROOT, 'tools', 'favicon-trace.json'), 'utf8'));
  const d = (pts) => 'M' + pts.map(([x, y]) => `${x} ${y}`).join('L') + 'Z';
  const shapes = trace.shapes.map((s) => `<path fill="${s.role === 'light' ? p.paper : 'url(#g)'}" d="${d(s.points)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="${trace.viewBox}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.cyan}"/><stop offset=".55" stop-color="${p.blue}"/><stop offset="1" stop-color="${p['violet-deep']}"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="${p.ground}"/>${shapes}</svg>\n`;
}

export function build({ registerPath = join(SRC, 'register.json'), out = join(ROOT, 'dist'), register = null, quiet = false } = {}) {
  const outDir = resolve(out);
  if (!outDir.startsWith(ROOT + sep)) throw new Error('refusing to write outside the project: ' + outDir);
  const reg = register || JSON.parse(readFileSync(registerPath, 'utf8'));
  const errs = validateRegister(reg);
  if (errs.length) throw new Error('register invalid:\n  ' + errs.join('\n  '));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const tokens = readFileSync(join(SRC, 'tokens.css'), 'utf8');
  const pal = paletteFrom(tokens);
  const pub = publicRegister(reg);
  const safeJson = JSON.stringify(pub).replace(/</g, '\\u003c');

  let html = readFileSync(join(SRC, 'index.html'), 'utf8');
  const map = {
    theme_color: pal.ground,
    register_json: safeJson,
    ca_slot: renderCaSlot(reg),
    social: renderSocial(reg),
    chain_label: renderChainLabel(reg),
    status_rows: renderStatusRows(reg),
    hero_facts: renderHeroFacts(reg),
    rpc_card: renderRpcCard(reg),
    own_row: renderOwnRow(reg),
  };
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => { if (!(k in map)) throw new Error('template slot without a renderer: ' + k); return map[k]; });
  writeFileSync(join(outDir, 'index.html'), html);

  for (const f of STATIC_FILES) copyFileSync(join(SRC, f), join(outDir, f));
  for (const f of LOGO_FILES) {
    const from = join(SRC, 'assets', f);
    if (!existsSync(from)) throw new Error('logo file missing from src/assets: ' + f + ' (run tools/make_assets.py)');
    copyFileSync(from, join(outDir, f));
  }
  writeFileSync(join(outDir, 'favicon.svg'), faviconSvg(tokens));
  writeFileSync(join(outDir, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n/*.png\n  Cache-Control: public, max-age=31536000, immutable\n');
  if (!quiet) {
    const files = [];
    (function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(relative(outDir, p)); } })(outDir);
    console.log('build ok -> ' + relative(ROOT, outDir) + '/  (' + files.join(', ') + ')');
  }
  return { outDir, register: reg };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
  try { build({ registerPath: arg('--register') ? resolve(arg('--register')) : undefined, out: arg('--out') ? resolve(arg('--out')) : undefined }); }
  catch (e) { console.error(e.message); process.exit(1); }
}
