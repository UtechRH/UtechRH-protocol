// Build-time markup for every register-driven slot. Pure string functions so the gate harness can call them too.
import { rec, isStated, handleFromUrl, DASH } from './core.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Official X mark (24 grid) and the official GitHub Octicon "mark-github" (16 grid).
export const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
export const GH_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';

const xSvg = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="${X_PATH}"/></svg>`;
const ghSvg = `<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="${GH_PATH}"/></svg>`;

const copyIcon = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5.75 1h6.5c.97 0 1.75.78 1.75 1.75v6.5A1.75 1.75 0 0 1 12.25 11h-6.5A1.75 1.75 0 0 1 4 9.25v-6.5C4 1.78 4.78 1 5.75 1Zm0 1.5a.25.25 0 0 0-.25.25v6.5c0 .14.11.25.25.25h6.5c.14 0 .25-.11.25-.25v-6.5a.25.25 0 0 0-.25-.25ZM2.75 5H3v1.5h-.25a.25.25 0 0 0-.25.25v6.5c0 .14.11.25.25.25h6.5a.25.25 0 0 0 .25-.25V13H10.5v.25A1.75 1.75 0 0 1 8.75 15h-6.5A1.75 1.75 0 0 1 .5 13.25v-6.5C.5 5.78 1.28 5 2.75 5Z"/></svg>';
export const COPY_ICON = copyIcon;

/** CA slot: top of the page, full address, click to copy. Inert (label + "pending") until the record is stated. */
export function renderCaSlot(register) {
  const r = rec(register, 'ca');
  if (isStated(r)) {
    const a = esc(r.value);
    return `<div class="ca-slot" data-ca-state="stated">
        <span class="ca-label">${esc(r.label)}</span>
        <button type="button" class="ca-value" data-copy="${a}" aria-label="Copy token contract">${a}</button>
        <button type="button" class="ca-copy" data-copy="${a}" aria-label="Copy token contract">${copyIcon}<span class="ca-copy-text">Copy</span></button>
        <span class="ca-feedback" role="status" aria-live="polite"></span>
      </div>`;
  }
  return `<div class="ca-slot is-inert" data-ca-state="${esc(r.state)}">
        <span class="ca-label">${esc(r.label)}</span>
        <span class="ca-value">pending</span>
        <button type="button" class="ca-copy" disabled aria-disabled="true" aria-label="Copy token contract, pending">${copyIcon}<span class="ca-copy-text">Copy</span></button>
        <span class="ca-feedback" role="status" aria-live="polite"></span>
      </div>`;
}

/** Icons only, both always present. A link exists only while its record is stated. */
export function renderSocial(register) {
  const item = (id, svg, name) => {
    const r = rec(register, id);
    if (isStated(r)) {
      return `<a class="icon-btn" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-social="${id}" aria-label="${esc(name)}, ${esc(handleFromUrl(r.url))}">${svg}</a>`;
    }
    return `<span class="icon-btn is-inert" role="img" data-social="${id}" aria-disabled="true" aria-label="${esc(name)}, pending">${svg}</span>`;
  };
  return item('x', xSvg, 'X') + item('github', ghSvg, 'GitHub');
}

export function renderChainLabel(register) {
  const r = rec(register, 'chain');
  if (!isStated(r)) return `${esc(r.label)} pending`;
  return `${esc(r.value.name)} · ${esc(r.value.chainIdDecimal)}`;
}

/** Status rows. Inert records show their label and the word "pending", nothing else. */
export function renderStatusRows(register) {
  const rows = [
    ['chain', 'Network'], ['ca', null], ['x', null], ['github', null], ['docs', null], ['console', null], ['audit', null], ['market-source', null],
  ];
  return rows.map(([id, override]) => {
    const r = rec(register, id);
    const label = override || r.label;
    let right;
    if (!isStated(r)) {
      right = '<span class="chip is-pending">pending</span>';
    } else if (id === 'chain') {
      right = `<span class="chip is-live">${esc(r.value.name)} · ${esc(r.value.chainIdDecimal)} · ${esc(r.value.chainId)}</span>`;
    } else if (id === 'ca') {
      right = '<span class="chip is-live">shown</span>';
    } else if (id === 'market-source') {
      right = '<span class="chip is-live">flowing</span>';
    } else if (r.url) {
      right = `<a class="chip is-live is-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(handleFromUrl(r.url))}</a>`;
    } else {
      right = '<span class="chip is-live">live</span>';
    }
    return `<li class="status-row spot" data-record="${id}"><span class="status-label">${esc(label)}</span>${right}</li>`;
  }).join('\n');
}

export function renderHeroFacts(register) {
  const c = rec(register, 'chain');
  const ca = rec(register, 'ca');
  return `<li><span class="fact-k">Network</span>${isStated(c) ? esc(c.value.name) + ' ' + esc(c.value.chainIdDecimal) : 'pending'}</li>
          <li><span class="fact-k">Market feed</span>Public pool listings, polled every minute</li>
          <li><span class="fact-k">Contract</span>${isStated(ca) ? 'Shown in the bar above' : 'pending'}</li>`;
}

export function renderRpcCard(register) {
  const c = rec(register, 'chain');
  if (!isStated(c)) return '<span class="chip is-pending">pending</span>';
  const rpc = esc(c.value.rpc);
  return `<div class="rpc"><span class="fact-k">Node address</span><button type="button" class="rpc-copy" data-copy="${rpc}" aria-label="Copy node address">${esc(c.value.rpc)}${copyIcon}</button></div>`;
}

/** Row #1 as it is served. Placeholder carries the brand logo (never a letter tile); live state is filled in by the client. */
export function renderOwnRow(register) {
  const ca = rec(register, 'ca');
  const stated = isStated(ca);
  const logo = '<img class="tile tile-logo" src="logo-128.png" width="36" height="36" alt="" decoding="async">';
  if (!stated) {
    return `<div class="mrow own-row is-placeholder spot" data-own="absent" data-row="own" aria-disabled="true">
        <span class="m-rank">1</span>
        <span class="m-token">${logo}<span class="m-names"><span class="m-sym">UTECH</span><span class="m-name">Utech</span></span></span>
        <span class="m-cell m-price">· · · · ·</span>
        <span class="m-cell m-chg">· · · · ·</span>
        <span class="m-cell m-vol">· · · · ·</span>
        <span class="m-cell m-liq">· · · · ·</span>
        <span class="m-act"></span>
      </div>`;
  }
  return `<div class="mrow own-row spot is-loading" data-own="stated" data-row="own">
        <span class="m-rank">1</span>
        <span class="m-token">${logo}<span class="m-names"><span class="m-sym">UTECH</span><span class="m-name">Utech</span></span></span>
        <span class="m-cell m-price">${DASH}</span>
        <span class="m-cell m-chg">${DASH}</span>
        <span class="m-cell m-vol">${DASH}</span>
        <span class="m-cell m-liq">${DASH}</span>
        <span class="m-act"><button type="button" class="copy-sym" data-copy="UTECH" aria-label="Copy symbol UTECH">${copyIcon}</button></span>
      </div>`;
}
