# Utech

**Track. Confirm. Resume.**

[![Live site](https://img.shields.io/badge/site-Utech.codes-01bffd)](https://Utech.codes)

Utech keeps a running record of what autonomous software has done, so a crash becomes a pause instead of a restart. This repository holds the public website, including a live market board for Robinhood Chain.

- **Chain:** Robinhood Chain, chain ID `0x1237` (4663)
- **Contract address:** _pending_ — the address bar on the site stays inert until one is published in `src/register.json`

## Overview

The site is a static page with no runtime dependencies. Every outside fact (contract address, social links, market sources) lives in one record in `src/register.json` with a state of `stated`, `absent` or `unconfirmed`. Anything not stated renders inert: no link, no value, just its label and the word "pending".

## Features

- Contract address bar pinned to the top of the page, full address, click to copy
- Live market board: the ten busiest Robinhood Chain pools by daily volume, polled every minute, paused while the tab is hidden
- Pinned own-token row that switches on when a contract address is stated
- Scroll-driven spring animation, parallax hero, scripted walkthrough, full `prefers-reduced-motion` support
- Gate suite that builds both contract-address branches and asserts them

## Links

- Site: https://Utech.codes
- X: https://x.com/Utech
- GitHub: _pending_

## Build

```bash
npm run build     # writes dist/, the folder to deploy
npm run gates     # builds both branches and runs every gate
npm run preview   # serves dist/ on localhost
```

Node 20 or newer. No packages to install. `tools/make_assets.py` (Python with Pillow) regenerates logo sizes and the favicon trace from `brand/`.

## License

MIT. See `LICENSE`.
