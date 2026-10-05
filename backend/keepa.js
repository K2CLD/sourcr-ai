const axios = require("axios");
const keepaTokens = require("./keepaTokens");

const KEEPA_KEY = process.env.KEEPA_KEY;

// Live token state, refreshed from the token fields Keepa returns on EVERY response
// (success or error): tokensLeft, refillIn (ms), refillRate (per minute), tokensConsumed.
const tokenState = {
  tokensLeft: null,
  refillIn: null,
  refillRate: null,
  tokensConsumed: null,
  updatedAt: null, // ms epoch of the response these values came from
};

function captureTokens(data) {
  if (!data || data.tokensLeft == null) return;
  tokenState.tokensLeft = data.tokensLeft;
  tokenState.refillIn = data.refillIn ?? null;
  tokenState.refillRate = data.refillRate ?? null;
  tokenState.tokensConsumed = data.tokensConsumed ?? null;
  tokenState.updatedAt = Date.now();
}

// Every Keepa call goes through here so token state stays current, including on errors
// (a 429 response still carries tokensLeft/refillIn).
async function keepaGet(endpoint, params, config = {}) {
  try {
    const res = await axios.get(`https://api.keepa.com/${endpoint}`, { ...config, params: { key: KEEPA_KEY, ...params } });
    captureTokens(res.data);
    return res;
  } catch (err) {
    captureTokens(err.response?.data);
    return handleKeepaError(err);
  }
}

// Token status endpoint — costs 0 tokens.
async function fetchTokenStatus() {
  await keepaGet("token", {});
  return getTokenState();
}

function getTokenState() {
  return { ...tokenState };
}

// Cached token state if it's recent, otherwise a fresh (free) /token check.
async function getFreshTokenState(maxAgeMs = 60000) {
  if (tokenState.tokensLeft != null && Date.now() - tokenState.updatedAt < maxAgeMs) return getTokenState();
  return fetchTokenStatus();
}

const CATEGORY_IDS = {
  beauty: 3760911,   // Beauty & Personal Care (was 11055981 — a generic "Products" node with only ~12K items)
  kitchen: 284507,   // Kitchen & Dining
  health: 3760901,
  toys: 165793011,
  pets: 2619533011,
  sports: 3375251,
  office: 1064954,
  baby: 165796011,
  tools: 228013,      // Tools & Home Improvement (was 468642 — actually "Video Games")
  electronics: 172282,
};

function handleKeepaError(err) {
  // Keepa's error shape for `data.error` varies by endpoint — sometimes a string,
  // sometimes an object like { type, message } — so normalize before checking it.
  const errData = err.response?.data?.error;
  const errText = typeof errData === "string" ? errData : errData?.message || errData?.type || "";
  if (err.response?.status === 429 || errText.includes("429") || /token/i.test(errText)) {
    // Keepa reports the account's real refill rate/timing on every response (including
    // errors) — report that instead of a hardcoded guess, which was wrong for this account
    // (measured 21/min via a live /token check, not the 1/min this message used to claim).
    const { refillRate, refillIn } = err.response?.data || {};
    const rateMsg = refillRate ? `tokens refill at ${refillRate}/min` : "check your Keepa plan's refill rate";
    const waitMsg = refillIn ? ` — next refill in ~${Math.ceil(refillIn / 1000)}s` : "";
    throw new Error(`Keepa API out of tokens — ${rateMsg}${waitMsg}. Wait and retry.`);
  }
  throw err;
}

const CATEGORY_BATCH_SIZE = 10; // Keepa's per-request limit for the /category endpoint

// Fetch category metadata (name, children) for a batch of Keepa category node IDs
async function fetchCategoryData(ids) {
  if (!ids.length) return {};
  const res = await keepaGet("category", { domain: 1, category: ids.join(",") });
  return res.data.categories || {};
}

async function fetchCategoryDataBatched(ids) {
  const data = {};
  for (let i = 0; i < ids.length; i += CATEGORY_BATCH_SIZE) {
    Object.assign(data, await fetchCategoryData(ids.slice(i, i + CATEGORY_BATCH_SIZE)));
  }
  return data;
}

// Amazon's browse-node tree often hides a root category's real subcategories one level
// behind a generic navigation node (named "Categories" or "Products" in Keepa's data) rather
// than exposing them as direct children. Other direct children are pure marketing/curation
// shortcuts (e.g. "Featured Categories", "Specialty Stores", "X Features") that no product is
// ever actually filed under, so they're useless as filter values and get dropped.
const CATEGORY_WRAPPER_NAMES = new Set(["Categories", "Products"]);
const CATEGORY_NOISE_NAMES = new Set(["Featured Categories", "Specialty Stores", "Sales & Deals"]);
const isCategoryNoise = (name) => CATEGORY_NOISE_NAMES.has(name) || /Features$/.test(name);

let _categoryTreeCache = null;

// Build the real Amazon subcategory tree for each of our 10 root categories, straight from
// Keepa's category API (which mirrors Amazon's own browse-node taxonomy) — not hand-authored.
// Cached in-memory for the process lifetime since this data almost never changes.
async function getCategoryTree() {
  if (_categoryTreeCache) return _categoryTreeCache;

  const rootIds = Object.values(CATEGORY_IDS);
  const rootData = await fetchCategoryData(rootIds);

  const directChildIds = [...new Set(
    Object.values(rootData).flatMap((c) => c?.children || [])
  )];
  const directChildData = await fetchCategoryDataBatched(directChildIds);

  const wrapperGrandchildIds = [...new Set(
    Object.values(directChildData)
      .filter((c) => c && CATEGORY_WRAPPER_NAMES.has(c.name))
      .flatMap((c) => c.children || [])
  )];
  const grandchildData = await fetchCategoryDataBatched(wrapperGrandchildIds);

  const tree = {};
  for (const [key, id] of Object.entries(CATEGORY_IDS)) {
    const root = rootData[id];
    const leaves = [];

    for (const childId of root?.children || []) {
      const child = directChildData[childId];
      if (!child) continue;

      if (CATEGORY_WRAPPER_NAMES.has(child.name)) {
        for (const gcId of child.children || []) {
          const gc = grandchildData[gcId];
          if (gc && !isCategoryNoise(gc.name)) leaves.push({ id: gc.catId, name: gc.name });
        }
      } else if (!isCategoryNoise(child.name)) {
        leaves.push({ id: child.catId, name: child.name });
      }
    }

    tree[key] = {
      id,
      name: root?.name || key,
      children: leaves.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  _categoryTreeCache = tree;
  return tree;
}

// Keepa csv/stats indices (Product.CsvType in keepacom/api_backend, checked against live data):
const IDX = {
  AMAZON: 0,            // Amazon's own offer price; -1 = Amazon not on the listing
  SALES: 3,             // sales rank (BSR)
  COUNT_NEW: 11,        // all New offers (FBA + FBM)
  RATING: 16,           // 0–50 (45 = 4.5★) — only returned with rating=1
  COUNT_REVIEWS: 17,    //                    only returned with rating=1
  BUY_BOX_SHIPPING: 18, // Buy Box price incl. shipping, -1 = no qualifying offer — only with buybox=1
  COUNT_NEW_FBA: 34,    // New FBA offers (includes Amazon)
};
// (The old code read index 28 as the Buy Box — 28 is EBAY_NEW_SHIPPING.)

const AMAZON_SELLER_ID = "ATVPDKIKX0DER";
const KEEPA_EPOCH_MINUTES = 21564000; // Keepa time = minutes since 2011-01-01
const keepaTimeToMs = (t) => (t + KEEPA_EPOCH_MINUTES) * 60000;
const cents = (v) => (v != null && v > 0 ? v / 100 : null);
const count = (v) => (v != null && v >= 0 ? v : null);

// Search for products in a category via Product Finder. Only real Product Finder fields
// work here — the old selection (minPrice/maxPrice/priceTypes/minRating/sortType) isn't
// part of that API and was silently ignored, so searches came back unfiltered and
// unsorted. Now: Buy Box price band, BSR ceiling, best sellers first.
// Returns the page's ASINs plus the tokens the call actually cost.
async function searchCategory(categoryId, { minPrice, maxPrice, maxBSR }, page = 0) {
  const selection = {
    categories_include: [CATEGORY_IDS[categoryId]],
    current_BUY_BOX_SHIPPING_gte: Math.round(minPrice * 100),
    current_BUY_BOX_SHIPPING_lte: Math.round(maxPrice * 100),
    current_SALES_gte: 1,
    current_SALES_lte: maxBSR,
    sort: [["current_SALES", "asc"]],
    perPage: 50,
    page,
  };

  const res = await keepaGet("query", { domain: 1, selection: JSON.stringify(selection) });

  return { asins: res.data.asinList || [], tokensConsumed: res.data.tokensConsumed ?? null };
}

// Share of the last `days` during which Amazon itself had an offer on the listing,
// time-weighted from the Amazon price history (csv[0]: [keepaTime, price, ...]).
function amazonPresencePct(csv0, days = 90) {
  if (!csv0?.length) return null;
  const end = Date.now();
  const start = end - days * 86400000;
  let present = 0;
  for (let i = 0; i < csv0.length; i += 2) {
    const from = Math.max(keepaTimeToMs(csv0[i]), start);
    const to = i + 2 < csv0.length ? Math.min(keepaTimeToMs(csv0[i + 2]), end) : end;
    if (to > from && csv0[i + 1] > 0) present += to - from;
  }
  return Math.round((present / (end - start)) * 100);
}

const firstPositive = (...vals) => vals.find((v) => v != null && v > 0) ?? null;

function parseProduct(p, full) {
  const s = p.stats || {};
  const cur = s.current || [];

  const bsr = cur[IDX.SALES] > 0 ? cur[IDX.SALES] : null;
  const bsr30 = s.avg30?.[IDX.SALES] > 0 ? s.avg30[IDX.SALES] : null;
  const bsr90 = s.avg90?.[IDX.SALES] > 0 ? s.avg90[IDX.SALES] : null;
  // Lower rank = more sales, so a 30d average below the 90d average is improving
  const bsrTrend = bsr30 && bsr90 ? (bsr30 < bsr90 ? "rising" : "falling") : "unknown";

  // Total New offers (FBA + FBM) — the maxSellers filter and private-label check use this
  const sellerCount = cur[IDX.COUNT_NEW] > 0 ? cur[IDX.COUNT_NEW] : null;
  const sellerCount30 = s.avg30?.[IDX.COUNT_NEW] > 0 ? s.avg30[IDX.COUNT_NEW] : null;
  const sellerCount90 = s.avg90?.[IDX.COUNT_NEW] > 0 ? s.avg90[IDX.COUNT_NEW] : null;

  const product = {
    asin: p.asin,
    // Keepa groups color/size/pack variants of the same listing under a shared
    // parentAsin (already present on every product response, no extra cost) —
    // used in scanner.js to dedupe near-identical variants before ranking.
    parentAsin: p.parentAsin || null,
    title: p.title,
    brand: p.brand,
    bsr,
    bsr30,
    bsr90,
    bsrTrend,
    newSellers30d: s.newOfferCount30 || 0,
    sellerCount,
    sellerCount30,
    sellerCount90,
    fbaSellerCount: count(cur[IDX.COUNT_NEW_FBA]),
    fbaSellerCount30: count(s.avg30?.[IDX.COUNT_NEW_FBA]),
    fbaSellerCount90: count(s.avg90?.[IDX.COUNT_NEW_FBA]),
    amazonSells: (cur[IDX.AMAZON] ?? -1) > 0,
    amazonOnListingPct90: amazonPresencePct(p.csv?.[IDX.AMAZON]),
    // Keepa-estimated units sold in the last 30 days (Amazon's "N+ bought" buckets) — not on every ASIN
    monthlySold: p.monthlySold ?? null,
    // Keepa lists hazardous-material aspects only when they apply
    hazmat: Array.isArray(p.hazardousMaterials) ? p.hazardousMaterials.length > 0 : false,
    subcategory: p.categoryTree?.[p.categoryTree.length - 1]?.name || "General",
    // Every level from root to leaf — the UI's subcategory picker lists the level just below
    // the root, while `subcategory` above is the deepest leaf, so filters match on the path.
    categoryPath: (p.categoryTree || []).map((c) => c.name),
    url: `https://www.amazon.com/dp/${p.asin}`,
    imageUrl: (() => {
      // p.imagesCSV is always empty; real image data is in p.images[].m (medium) or .l (large)
      const file = p.images?.[0]?.m || p.images?.[0]?.l;
      if (!file) return null;
      // Insert ._AC_SL75_ before the .jpg extension for a 75px thumbnail
      return `https://images-na.ssl-images-amazon.com/images/I/${file.replace(/\.jpg$/i, '._AC_SL75_.jpg')}`;
    })(),
    detailLevel: full ? "full" : "basic",
  };

  if (!full) return product;

  // Buy Box (index 18) — only present with buybox=1. 90-day min/max are minInInterval /
  // maxInInterval (stats=90 sets the interval); stats.min/max are all-time extremes.
  const priceAvg90 = cents(s.avg90?.[IDX.BUY_BOX_SHIPPING]);
  const priceMin90 = cents(s.minInInterval?.[IDX.BUY_BOX_SHIPPING]?.[1]);
  const priceMax90 = cents(s.maxInInterval?.[IDX.BUY_BOX_SHIPPING]?.[1]);
  const ratingRaw = firstPositive(cur[IDX.RATING], s.avg30?.[IDX.RATING], s.avg90?.[IDX.RATING]);
  const amazonBuyBoxPct = s.buyBoxStats?.[AMAZON_SELLER_ID]?.percentageWon;

  return {
    ...product,
    price: cents(cur[IDX.BUY_BOX_SHIPPING]),
    priceAvg90,
    priceMin90,
    priceMax90,
    priceStable: priceMin90 && priceMax90 ? (priceMax90 - priceMin90) / priceMax90 < 0.2 : null,
    amazonBuyBoxPct90: amazonBuyBoxPct != null ? Math.round(amazonBuyBoxPct) : null,
    rating: ratingRaw != null ? ratingRaw / 10 : null,
    reviews: firstPositive(cur[IDX.COUNT_REVIEWS], s.avg30?.[IDX.COUNT_REVIEWS], s.avg90?.[IDX.COUNT_REVIEWS]),
  };
}

// Get product data for a list of ASINs.
//  basic (default) — stats + history, 1 token/ASIN: BSR, offer counts, monthly sales, Amazon
//    presence. No price: the Buy Box is only returned with buybox=1.
//  full — adds buybox=1 and rating=1 (measured ~4 tokens/ASIN): Buy Box price + 90-day
//    history, rating, review count. The scanner only fetches this for products that pass
//    the cheap basic filters.
// `onDrop(asin, missingFields)` is called for each returned product discarded for missing a
// required field (BSR; plus the Buy Box price on a full fetch).
async function getProductDetails(asins, { full = false, onDrop = null } = {}) {
  const res = await keepaGet("product", {
    domain: 1,
    asin: asins.join(","),
    stats: 90,
    history: 1,
    ...(full ? { buybox: 1, rating: 1 } : {}),
  });
  keepaTokens.recordProductLookup(res.data.tokensConsumed, asins.length, full ? "perAsinFull" : "perAsin");

  return (res.data.products || []).map((p) => parseProduct(p, full)).filter((p) => {
    const missing = [!p.bsr && "BSR", full && !p.price && "Buy Box price"].filter(Boolean);
    if (!missing.length) return true;
    if (onDrop) onDrop(p.asin, missing);
    return false;
  });
}

module.exports = { keepaGet, searchCategory, getProductDetails, getCategoryTree, fetchTokenStatus, getTokenState, getFreshTokenState, CATEGORY_IDS };
