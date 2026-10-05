const axios = require("axios");

const LWA_URL = "https://api.amazon.com/auth/o2/token";

// SP-API base URL varies by region — na/eu/fe map to the three SP-API endpoints
const SP_API_HOSTS = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const REGION = (process.env.SP_API_REGION || "na").toLowerCase();
const SP_API_BASE = SP_API_HOSTS[REGION] || SP_API_HOSTS.na;

const MARKETPLACE_ID = process.env.SP_API_MARKETPLACE_ID || "ATVPDKIKX0DER";
const CATALOG_API_VERSION = "2022-04-01";

// Catalog Items GetCatalogItem is rate-limited to ~2 req/sec (burst 2) — space batch calls out
const CATALOG_RATE_LIMIT_DELAY_MS = 550;
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-category ungating profile used as fallback when SP-API creds aren't set
const CATEGORY_PROFILES = {
  beauty:      { typicallyGated: true,  autoUngate: true,  notes: "Often auto-approved with 90-day+ account history and good health metrics" },
  health:      { typicallyGated: true,  autoUngate: true,  notes: "Often auto-approved with 90-day+ account history and good health metrics" },
  toys:        { typicallyGated: true,  autoUngate: true,  notes: "Auto-ungates Q4 (Oct–Dec) with 3+ months selling history" },
  baby:        { typicallyGated: true,  autoUngate: true,  notes: "May auto-approve with established account and good metrics" },
  grocery:     { typicallyGated: true,  autoUngate: false, notes: "Usually requires invoices and manual Seller Central review" },
  electronics: { typicallyGated: true,  autoUngate: false, notes: "Brand-level gating — most require manual brand approval" },
  pets:        { typicallyGated: false, autoUngate: true,  notes: "Generally open; some premium brands gated" },
  sports:      { typicallyGated: false, autoUngate: true,  notes: "Generally open category" },
  tools:       { typicallyGated: false, autoUngate: true,  notes: "Generally open category" },
  office:      { typicallyGated: false, autoUngate: true,  notes: "Generally open category" },
  kitchen:     { typicallyGated: false, autoUngate: true,  notes: "Generally open category" },
};

let _accessToken = null;
let _tokenExpiry = 0;
let _tokenPromise = null; // coalesces concurrent refreshes (e.g. batch ungating + catalog lookups firing together)

function hasCredentials() {
  return !!(
    process.env.SP_API_CLIENT_ID &&
    process.env.SP_API_CLIENT_SECRET &&
    process.env.SP_API_REFRESH_TOKEN &&
    process.env.SP_API_SELLER_ID
  );
}

// Retry a request on 429/503, honoring Retry-After when present and otherwise
// backing off exponentially with jitter. Non-retryable errors pass straight through.
async function requestWithRetry(fn, { retries = MAX_RETRIES, label = "SP-API" } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      const retryable = status === 429 || status === 503;
      if (!retryable || attempt >= retries) throw err;

      const retryAfter = err.response?.headers?.["retry-after"];
      const delay = retryAfter
        ? parseFloat(retryAfter) * 1000
        : RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 250;

      console.warn(`[${label}] ${status} — retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(delay);
    }
  }
}

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;
  if (_tokenPromise) return _tokenPromise;

  _tokenPromise = requestWithRetry(
    () =>
      axios.post(
        LWA_URL,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: process.env.SP_API_REFRESH_TOKEN,
          client_id: process.env.SP_API_CLIENT_ID,
          client_secret: process.env.SP_API_CLIENT_SECRET,
        }),
        { timeout: 8000 }
      ),
    { label: "LWA" }
  )
    .then((res) => {
      _accessToken = res.data.access_token;
      _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
      return _accessToken;
    })
    .finally(() => {
      _tokenPromise = null;
    });

  return _tokenPromise;
}

async function checkViaSpApi(asin) {
  const token = await getAccessToken();

  const res = await requestWithRetry(() =>
    axios.get(`${SP_API_BASE}/listings/2021-08-01/restrictions`, {
      params: {
        asin,
        sellerId: process.env.SP_API_SELLER_ID,
        marketplaceIds: MARKETPLACE_ID,
        // Amazon rejects "new"/"New" with 400 InvalidInput — the Listings
        // Restrictions API uses compound condition values (new_new,
        // used_good, collectible_like_new, ...), confirmed via a live call.
        conditionType: "new_new",
      },
      headers: {
        "x-amz-access-token": token,
        "x-amz-date": new Date().toISOString().replace(/[:-]/g, "").split(".")[0] + "Z",
      },
      timeout: 10000,
    })
  );

  const restrictions = res.data.restrictions || [];

  if (restrictions.length === 0) {
    return {
      gated: false,
      autoUngatable: true,
      method: "sp-api",
      approvalUrl: null,
      notes: "No restrictions — you can list this item",
    };
  }

  const allLinks = restrictions.flatMap((r) =>
    (r.reasons || []).flatMap((reason) => reason.links || [])
  );
  // A "request approval" link means an approval application PROCESS exists —
  // i.e. manual action is required — not that one can be skipped. Any
  // restriction at all means this is gated and not auto-ungatable; the link
  // (if present) is kept only as a reference for manually pursuing approval.
  const approvalLink = allLinks.find(
    (l) => l.title?.toLowerCase().includes("request") || l.resource?.includes("approval")
  );

  return {
    gated: true,
    autoUngatable: false,
    method: "sp-api",
    approvalUrl: approvalLink?.resource || null,
    // e.g. APPROVAL_REQUIRED (an application exists) vs NOT_ELIGIBLE (hard block)
    reasonCodes: [...new Set(restrictions.flatMap((r) => (r.reasons || []).map((x) => x.reasonCode)).filter(Boolean))],
    notes: restrictions[0]?.reasons?.[0]?.message || "Restricted",
  };
}

// ─── Catalog Items — sales rank (BSR) lookup ──────────────────────────────────

async function getCatalogItem(asin) {
  const token = await getAccessToken();

  const res = await requestWithRetry(() =>
    axios.get(`${SP_API_BASE}/catalog/${CATALOG_API_VERSION}/items/${asin}`, {
      params: {
        marketplaceIds: MARKETPLACE_ID,
        includedData: "salesRanks",
      },
      headers: { "x-amz-access-token": token },
      timeout: 10000,
    })
  );

  return res.data;
}

// Pull the primary (lowest/most specific classification) sales rank out of a
// Catalog Items response. displayGroupRanks (e.g. "home_garden_display_on_website")
// is preferred over classificationRanks since it matches what shoppers/BSR badges show.
function extractSalesRank(catalogItem) {
  const entry = catalogItem?.salesRanks?.find((r) => r.marketplaceId === MARKETPLACE_ID) || catalogItem?.salesRanks?.[0];
  if (!entry) return null;

  const rank = entry.displayGroupRanks?.[0]?.rank ?? entry.classificationRanks?.[0]?.rank;
  return rank > 0 ? rank : null;
}

// Look up current BSR for a single ASIN via Catalog Items. Returns null (not throw)
// on failure so batch callers can fall back to another source per-ASIN.
async function getSalesRank(asin) {
  try {
    const item = await getCatalogItem(asin);
    return extractSalesRank(item);
  } catch (err) {
    console.warn(`[SP-API] Catalog Items lookup failed for ${asin}: ${err.message}`);
    return null;
  }
}

// Look up BSR for many ASINs, respecting Catalog Items' ~2 req/sec rate limit.
// Returns a { asin: bsr | null } map — callers decide how to fall back on nulls.
// Bails out of the whole batch on a 401 (bad/expired credentials, not a per-item issue) —
// every remaining call would fail the same way, so there's no point paying the rate-limit
// sleep + round trip for each one.
async function batchGetSalesRanks(asins) {
  const results = {};

  for (let i = 0; i < asins.length; i++) {
    const asin = asins[i];
    try {
      const item = await getCatalogItem(asin);
      results[asin] = extractSalesRank(item);
    } catch (err) {
      if (err.response?.status === 401) {
        console.warn(`[SP-API] Catalog Items auth failed (401) — aborting BSR refresh for the remaining ${asins.length - i} ASINs this scan`);
        for (let j = i; j < asins.length; j++) results[asins[j]] = null;
        return results;
      }
      console.warn(`[SP-API] Catalog Items lookup failed for ${asin}: ${err.message}`);
      results[asin] = null;
    }
    if (i < asins.length - 1) await sleep(CATALOG_RATE_LIMIT_DELAY_MS);
  }

  return results;
}

// ─── Product Fees — real referral + FBA fees ──────────────────────────────────

const FEES_BATCH_SIZE = 20;            // getMyFeesEstimates accepts up to 20 items per call
const FEES_RATE_LIMIT_DELAY_MS = 2100; // 0.5 req/sec (x-amzn-ratelimit-limit on a live call)

const feeAmount = (details, type) =>
  details?.find((d) => d.FeeType === type)?.FinalFee?.Amount ?? null;

// Amazon's own fee estimate at a given sale price, FBA-fulfilled. items: [{ asin, price }].
// Returns { asin: { referralFee, fbaFee, closingFee, totalFees } | null } — null when Amazon
// couldn't estimate that ASIN, so callers can fall back per item.
async function batchGetFeesEstimates(items) {
  const results = {};
  const token = await getAccessToken();

  for (let i = 0; i < items.length; i += FEES_BATCH_SIZE) {
    const batch = items.slice(i, i + FEES_BATCH_SIZE);
    const body = batch.map(({ asin, price }) => ({
      IdType: "ASIN",
      IdValue: asin,
      FeesEstimateRequest: {
        MarketplaceId: MARKETPLACE_ID,
        IsAmazonFulfilled: true,
        Identifier: asin,
        PriceToEstimateFees: { ListingPrice: { CurrencyCode: "USD", Amount: price } },
      },
    }));

    try {
      const res = await requestWithRetry(
        () =>
          axios.post(`${SP_API_BASE}/products/fees/v0/feesEstimate`, body, {
            headers: { "x-amz-access-token": token, "content-type": "application/json" },
            timeout: 15000,
          }),
        { label: "SP-API Fees" }
      );
      for (const r of res.data || []) {
        const asin = r.FeesEstimateIdentifier?.IdValue;
        if (!asin) continue;
        const est = r.Status === "Success" ? r.FeesEstimate : null;
        results[asin] = est
          ? {
              referralFee: feeAmount(est.FeeDetailList, "ReferralFee"),
              fbaFee: feeAmount(est.FeeDetailList, "FBAFees"),
              closingFee: feeAmount(est.FeeDetailList, "VariableClosingFee"),
              totalFees: est.TotalFeesEstimate?.Amount ?? null,
            }
          : null;
        if (!est) console.warn(`[SP-API Fees] No estimate for ${asin}: ${r.Error?.Message || r.Status}`);
      }
    } catch (err) {
      console.warn(`[SP-API Fees] Batch failed (${err.response?.status || err.message}) — ${batch.length} ASIN(s) fall back to estimated fees`);
    }
    if (i + FEES_BATCH_SIZE < items.length) await sleep(FEES_RATE_LIMIT_DELAY_MS);
  }
  return results;
}

function checkByCategory(category) {
  const profile = CATEGORY_PROFILES[category];
  if (!profile) {
    return {
      gated: null,
      autoUngatable: null,
      method: "heuristic",
      approvalUrl: null,
      notes: "Category not profiled — check Seller Central",
    };
  }
  return {
    gated: profile.typicallyGated,
    autoUngatable: profile.autoUngate,
    method: "heuristic",
    approvalUrl: null,
    notes: profile.notes,
  };
}

async function checkUngating(asin, category) {
  if (hasCredentials()) {
    try {
      return await checkViaSpApi(asin);
    } catch (err) {
      console.warn(`[SP-API] ungating check failed for ${asin}: ${err.message}`);
    }
  }
  return checkByCategory(category);
}

async function batchCheckUngating(products) {
  const results = await Promise.allSettled(
    products.map((p) => checkUngating(p.asin, p.category))
  );

  return products.map((p, i) => ({
    ...p,
    ungating:
      results[i].status === "fulfilled"
        ? results[i].value
        : { gated: null, autoUngatable: null, method: "error", approvalUrl: null, notes: "Check failed" },
  }));
}

module.exports = {
  checkUngating,
  batchCheckUngating,
  hasCredentials,
  getCatalogItem,
  getSalesRank,
  batchGetSalesRanks,
  batchGetFeesEstimates,
};
