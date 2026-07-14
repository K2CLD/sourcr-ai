# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sourcr AI — an Amazon FBA sourcing tool. It scans Amazon categories (via Keepa) or a supplier's price-list CSV for products that are profitable to resell on Amazon, scores/grades each lead, checks Amazon ungating status, and optionally emails alerts on a cron schedule. A React frontend lets a user trigger scans and browse results; Claude is used to generate a plain-English buy/pass verdict and to suggest off-Amazon sourcing options for a lead.

## Commands

Backend (root):
```
node server.js          # start the API server on port 3001 (no npm start script defined)
```
There is no backend test suite (`npm test` at root is an unconfigured stub) and no backend lint config.

Frontend (`frontend/`):
```
npm run dev        # Vite dev server on port 5173, proxies /api/* to http://localhost:3001
npm run build       # production build to frontend/dist
npm run lint         # eslint
npm run preview      # preview a production build
```

Both the backend (root `package.json`) and frontend (`frontend/package.json`) have independent `node_modules` — install in both places.

Secrets live in a root-level `.env` (gitignored), loaded via `dotenv` in `server.js` and `backend/scheduler.js`. Keys used: `KEEPA_KEY`, `SELLERAMP_KEY`, `ANTHROPIC_KEY`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`, `ALERT_EMAIL`, `SP_API_CLIENT_ID`/`SP_API_CLIENT_SECRET`/`SP_API_REFRESH_TOKEN`/`SP_API_SELLER_ID`/`SP_API_MARKETPLACE_ID`.

## Architecture

**Backend** is plain CommonJS Express (`server.js` is a thin route layer — all logic lives in `backend/*.js`, each a stateless module of exported functions, no classes). **Frontend** is Vite + React 19, all state lives in `App.jsx` via `useState` (no router, no global store); `frontend/src/api.js` is the single axios client wrapping every backend route.

### The scan pipeline (`backend/scanner.js`)

This is the core of the app — everything else feeds into or reads from it. A scan is a fixed pipeline of stages, each implemented in its own module:

1. **Search** — `keepa.js` `searchCategory()` finds ASINs in a category within a price band (category scans), or `supplier.js` `matchSupplierToAmazon()` resolves a supplier CSV's UPC/title rows to ASINs via Keepa (supplier scans).
2. **Enrich** — `keepa.js` `getProductDetails()` fetches full product stats (price, BSR, rating, trend, price stability) in batches of 20 ASINs (Keepa's per-request limit).
3. **Pre-filter** — `scanner.js` `preFilter()` drops products outside price/BSR/rating/review thresholds *before* the costly profit calculation.
4. **Profit calc** — `selleramp.js` `batchCalculate()` calls the SellerAmp API per ASIN; on any failure (including no API key) it transparently falls back to `fallbackCalculate()`, which estimates sale price as `buyPrice * 2.5` and applies standard FBA fee tiers. Callers generally can't tell which path ran except via `profitData.source` (`"selleramp"` vs `"fallback"`).
5. **Post-filter** — `scanner.js` `postFilter()` drops products below ROI/profit thresholds or flagged restricted/hazmat.
6. **Score** — `scorer.js` `scoreProducts()` assigns each product a 0–100 weighted score (ROI, BSR, BSR trend, price stability, rating, reviews, absolute profit, new-seller competition) and a letter grade A–D, then `filterByGrade()` drops anything below the requested minimum grade.
7. **Ungating** — `spapi.js` `batchCheckUngating()` checks whether each surviving lead can actually be listed: uses real SP-API restriction data when SP-API credentials are configured (`hasCredentials()`), otherwise falls back to a static per-category heuristic table (`CATEGORY_PROFILES`).

All three entry points (`scanCategory`, `scanSupplierProducts`, `scanAsin`) run this same shape of pipeline; `scanMultipleCategories` just runs `scanCategory` per category and re-scores the merged list. When changing filter/scoring behavior, check whether it belongs in `preFilter`/`postFilter` (cheap, pre-API-call) vs `scorer.js` (post-filter ranking) — the split exists to avoid calling SellerAmp/SP-API on products that are already disqualified.

### AI layer (`backend/ai.js`)

Independent of the scan pipeline — operates on already-scored leads. Uses `claude-sonnet-4-6` for full lead analysis (`analyzeLead`, JSON verdict) and `claude-haiku-4-5-20251001` for cheap one-liners (`quickTake`) and sourcing suggestions (`findSupplierSources`). `findSupplierSources` asks Claude to suggest off-Amazon retailers to buy from, then hard-filters the response against an `AMAZON_DOMAINS` blocklist and tiers results against a `VERIFIED_RETAILERS` allowlist — this filtering happens in code, not in the prompt, since the model's output can't be trusted to self-enforce the exclusion.

### Scheduler (`backend/scheduler.js`)

Wraps `scanMultipleCategories` in a `node-cron` job (`startScheduler`/`stopScheduler`, in-memory single-task state — not persisted across restarts) and emails an HTML digest of results via nodemailer when `SMTP_USER`/`ALERT_EMAIL` are set (silently skipped otherwise). Keeps the results of the last run in memory (`getLastResults`) for the `/scheduler/results` endpoint.

### Frontend

`App.jsx` composes `StatusBar`, `ScanControls` (category multi-select + filter inputs, calls `onScan`), and `LeadTable` (renders results; `LeadCard.jsx` is dead code — merged into `LeadTable`). No CSS framework classes are used despite Tailwind being installed — components use inline `style` objects. Dev server proxies `/api` to the backend at `:3001` (see `vite.config.js`); there is no production reverse-proxy config in this repo — `frontend/dist` is a static build output only.

### Key domain facts worth knowing before touching scoring/filtering logic

- Keepa's price field priority is buy-box price (index 28) → Amazon's own price (index 0) → third-party marketplace price (index 1) — see the comment in `keepa.js` `getProductDetails`.
- Rating/review counts are frequently missing from Keepa's `current` stats; `keepa.js` falls back to `avg30`/`avg90`, and `scanner.js` `preFilter` treats `null` rating/reviews as passing (doesn't penalize missing data).
- BSR trend and price stability are derived by comparing 30-day vs 90-day Keepa averages, not by reading raw history.
- Grade thresholds (`scorer.js`): A ≥ 75, B ≥ 55, C ≥ 35, D otherwise, from a 0–100 clamped weighted score.
