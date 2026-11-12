// Pure logic shared by the build, the browser and the gate harness. No DOM access in here.

export const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
export const STATES = ['stated', 'absent', 'unconfirmed'];
export const POLL_MS = 60000;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 60000;
export const BOARD_SIZE = 10;

export const isStated = (rec) => !!rec && rec.state === 'stated';
export const isAddress = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);

/** Return the record, or a synthetic absent one so callers never branch on undefined. */
export function rec(register, id) {
  const r = register && register.records && register.records[id];
  return r || { label: id, state: 'absent' };
}

/** The stated contract address, or null. The only value the address scanner will let through. */
export function statedCa(register) {
  const r = rec(register, 'ca');
  return isStated(r) && isAddress(r.value) ? r.value : null;
}

/** Derive a display handle from a stored URL. Handles are never stored. */
export function handleFromUrl(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg : '';
  } catch { return ''; }
}

/**
 * Gate warning. Address-shaped strings are matched against the stated registry; 0x hex that is not
 * address-shaped (for instance a chain id) is never touched.
 * Returns { text, flagged } where flagged lists every foreign address that was withheld.
 */
export function gateText(text, register) {
  const ok = statedCa(register);
  const flagged = [];
  const out = String(text == null ? '' : text).replace(ADDRESS_RE, (m) => {
    if (ok && m.toLowerCase() === ok.toLowerCase()) return m;
    flagged.push(m);
    return '—';
  });
  return { text: out, flagged };
}

/** Scan arbitrary markup/text: every address-shaped string must equal the stated CA. */
export function scanAddresses(text, register) {
  const ok = statedCa(register);
  const bad = [];
  for (const m of String(text).match(ADDRESS_RE) || []) {
    if (!ok || m.toLowerCase() !== ok.toLowerCase()) bad.push(m);
  }
  return bad;
}

export function validateRegister(register) {
  const errs = [];
  const recs = (register && register.records) || {};
  for (const [id, r] of Object.entries(recs)) {
    if (!STATES.includes(r.state)) errs.push(`${id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const k of Object.keys(r)) {
        if (!['label', 'state', 'source', 'scope', 'stamp'].includes(k)) errs.push(`${id}: inert record carries "${k}"`);
      }
    } else if (!('value' in r) && !('url' in r)) errs.push(`${id}: stated record has no value or url`);
  }
  const ca = recs.ca;
  if (ca && ca.state === 'stated' && !isAddress(ca.value)) errs.push('ca: stated value is not a 42-character address');
  return errs;
}

/** Strip data-only fields (dates) before anything reaches the page. */
export function publicRegister(register) {
  const clone = JSON.parse(JSON.stringify(register));
  for (const r of Object.values(clone.records || {})) delete r.stamp;
  return clone;
}

// ---------------------------------------------------------------------------------------------
// market
// ---------------------------------------------------------------------------------------------

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The market plan depends on the market-source record and on nothing else. */
export function marketPlan(register) {
  const r = rec(register, 'market-source');
  return { live: isStated(r), url: isStated(r) ? r.url : null, pollMs: POLL_MS };
}

/** Own-token plan: the only place CA state is allowed to matter. */
export function ownPlan(register) {
  const ca = statedCa(register);
  const src = rec(register, 'own-token-source');
  if (!ca || !isStated(src)) return { live: false, url: null, ca: null };
  return { live: true, url: src.url.replace('{CA}', ca), ca };
}

/**
 * GeckoTerminal trending pools -> unique token rows, highest 24h volume first.
 * tokens come from included[] (type === "token"); pools match them by relationships.base_token.data.id.
 */
export function parseTrending(json) {
  const tokens = new Map();
  for (const inc of (json && json.included) || []) {
    if (inc && inc.type === 'token') tokens.set(inc.id, inc.attributes || {});
  }
  const rows = [];
  const seen = new Set();
  for (const pool of (json && json.data) || []) {
    const a = pool.attributes || {};
    const baseId = pool.relationships && pool.relationships.base_token && pool.relationships.base_token.data && pool.relationships.base_token.data.id;
    const t = tokens.get(baseId);
    if (!t) continue;
    const vol = num(a.volume_usd && a.volume_usd.h24);
    rows.push({
      key: baseId,
      address: String(t.address || '').toLowerCase(),
      symbol: t.symbol || '',
      name: t.name || '',
      logo: t.image_url && t.image_url !== 'missing.png' ? t.image_url : null,
      price: num(t.price_usd) ?? num(a.base_token_price_usd),
      change: num(a.price_change_percentage && a.price_change_percentage.h24),
      volume: vol,
      liquidity: num(a.reserve_in_usd),
    });
  }
  rows.sort((x, y) => (y.volume ?? -1) - (x.volume ?? -1));
  return rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

/** DexScreener tokens/{CA}: highest volume.h24 pair first. */
export function selectPair(json) {
  const pairs = ((json && json.pairs) || []).slice();
  pairs.sort((a, b) => (num(b.volume && b.volume.h24) ?? -1) - (num(a.volume && a.volume.h24) ?? -1));
  const p = pairs[0];
  if (!p) return null;
  return {
    symbol: (p.baseToken && p.baseToken.symbol) || '',
    name: (p.baseToken && p.baseToken.name) || '',
    price: num(p.priceUsd),
    change: num(p.priceChange && p.priceChange.h24),
    volume: num(p.volume && p.volume.h24),
    liquidity: num(p.liquidity && p.liquidity.usd),
  };
}

/** Row 1 is always ours. Rows 2..10 are trending, with our own token removed from them. */
export function composeBoard(own, trending, ca) {
  const rest = trending.filter((r) => !(ca && r.address && r.address === ca.toLowerCase()));
  return [own, ...rest.slice(0, BOARD_SIZE - 1)];
}

export function backoffMs(attempt, rand = 0.5) {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(base * (0.85 + rand * 0.3));
}

// ---------------------------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------------------------

export const DASH = '—';

export function fmtUsd(v) {
  if (v === null || v === undefined) return DASH;
  const a = Math.abs(v);
  if (a >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 1) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (a === 0) return '$0.00';
  const digits = Math.min(10, Math.max(4, 2 - Math.floor(Math.log10(a)) + 2));
  return '$' + v.toFixed(digits);
}

export function fmtCompact(v) {
  if (v === null || v === undefined) return DASH;
  const a = Math.abs(v);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [d, s] of units) if (a >= d) return '$' + (v / d).toFixed(a / d >= 100 ? 0 : a / d >= 10 ? 1 : 2) + s;
  return '$' + v.toFixed(0);
}

export function fmtPct(v) {
  if (v === null || v === undefined) return DASH;
  const s = Math.abs(v) >= 1000 ? Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : Math.abs(v).toFixed(2);
  return (v >= 0 ? '+' : '−') + s + '%';
}

export const tileLetter = (symbol) => (String(symbol || '?').replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase();

// ---------------------------------------------------------------------------------------------
// damped spring (semi-implicit Euler, fixed substeps). Returns the settled value path as a stepper.
// ---------------------------------------------------------------------------------------------

export function spring({ stiffness = 170, damping = 22, mass = 1, from = 0, to = 1, velocity = 0 } = {}) {
  let x = from;
  let v = velocity;
  return {
    step(dt) {
      const sub = 4;
      const h = Math.min(dt, 0.064) / sub;
      for (let i = 0; i < sub; i++) {
        const a = (-stiffness * (x - to) - damping * v) / mass;
        v += a * h;
        x += v * h;
      }
      return x;
    },
    get value() { return x; },
    get done() { return Math.abs(x - to) < 0.001 && Math.abs(v) < 0.001; },
  };
}
