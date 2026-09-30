const { searchCategory, getProductDetails, CATEGORY_IDS } = require("./keepa");
const { batchCalculate } = require("./selleramp");
const { scoreProducts, filterByGrade } = require("./scorer");
const { getMatched } = require("./supplier");
const { batchCheckUngating, batchGetSalesRanks, hasCredentials } = require("./spapi");
const keepaCache = require("./keepaCache");

const KEEPA_BATCH_SIZE = 100; // Keepa's actual /product limit (was wrongly set to 20 — 5x more requests than needed)

const DEFAULT_OPTIONS = {
  minPrice: 10,
  maxPrice: 70,
  minROI: 30,
  minProfit: 3,
  minRating: 4.0,
  maxBSR: 50000,
  minReviews: 10,
  minGrade: "B",
  pages: 2,
  excludeRestricted: true,
  excludeHazmat: true,
  maxSellers: 5,
  excludeAmazonSeller: true,
  minMonthlyUnits: 100,
  subcategories: [], // real leaf category names (product.subcategory) — empty means no restriction
  excludePrivateLabel: true,
};

// A listing is "likely private label" if the same single seller has held it with no
// competition across current/30d-avg/90d-avg offer counts — i.e. no fluctuation over time,
// consistent with one brand owner exclusively selling it. This is the one signal Keepa's
// existing data (already fetched, no extra API calls) can support reliably:
//  - Whether that sole seller IS the brand, and whether the brand is Amazon Brand Registry
//    enrolled, aren't exposed by Keepa or SP-API Catalog Items for arbitrary ASINs — the
//    only way to check either would be a per-ASIN Keepa Seller-API lookup (extra tokens) to
//    resolve the seller's name and compare it to `brand`, which isn't wired in here.
//  - "Recognizable major manufacturer" would require a hand-maintained brand allowlist, which
//    isn't real data and isn't included.
function isLikelyPrivateLabel(p) {
  return (
    p.sellerCount != null && p.sellerCount <= 1 &&
    (p.sellerCount30 == null || p.sellerCount30 <= 1) &&
    (p.sellerCount90 == null || p.sellerCount90 <= 1)
  );
}

// Fetch Keepa product details, in batches of up to 100 ASINs (Keepa's actual per-request
// limit for /product). Backed by a 24h-TTL disk cache (keepaCache.js) — an ASIN fetched by
// an earlier scan (including one from a previous app run, or a different category in the
// same scanMultipleCategories call) is served from cache instead of re-spending a token,
// as long as that data isn't stale.
async function fetchDetails(asins) {
  const unique = [...new Set(asins)];
  const fromCache = [];
  const toFetch = [];

  for (const asin of unique) {
    const cached = keepaCache.get(asin);
    if (cached) fromCache.push(cached);
    else toFetch.push(asin);
  }

  const freshlyFetched = [];
  for (let i = 0; i < toFetch.length; i += KEEPA_BATCH_SIZE) {
    const batch = toFetch.slice(i, i + KEEPA_BATCH_SIZE);
    const details = await getProductDetails(batch);
    freshlyFetched.push(...details);
    details.forEach((d) => keepaCache.set(d.asin, d));
  }
  keepaCache.flush();

  if (toFetch.length) {
    console.log(`[Scanner] Keepa: ${fromCache.length} from cache, ${toFetch.length} fetched fresh`);
  }

  return [...fromCache, ...freshlyFetched];
}

// Refresh BSR from SP-API Catalog Items when credentials are configured, since it
// reflects Amazon's current rank rather than Keepa's periodic snapshot. Keepa's bsr
// (already on each product) is kept as the fallback whenever SP-API has no creds,
// fails, or doesn't return a rank for that ASIN.
async function enrichBsr(products) {
  if (!hasCredentials() || !products.length) {
    return products.map((p) => ({ ...p, bsrSource: "keepa" }));
  }

  console.log(`[Scanner] Refreshing BSR for ${products.length} products via SP-API Catalog Items...`);
  const salesRanks = await batchGetSalesRanks(products.map((p) => p.asin));

  return products.map((p) => {
    const spBsr = salesRanks[p.asin];
    return spBsr != null ? { ...p, bsr: spBsr, bsrSource: "sp-api" } : { ...p, bsrSource: "keepa" };
  });
}

function preFilter(products, opts) {
  return products.filter(
    (p) =>
      p.price >= opts.minPrice &&
      p.price <= opts.maxPrice &&
      p.bsr <= opts.maxBSR &&
      // Skip rating/review/seller/units checks when Keepa has no data — don't penalise missing stats
      (p.rating      == null || p.rating      >= opts.minRating) &&
      (p.reviews     == null || p.reviews     >= opts.minReviews) &&
      (p.sellerCount  == null || p.sellerCount  <= opts.maxSellers) &&
      (p.monthlySold  == null || p.monthlySold  >= opts.minMonthlyUnits) &&
      (!opts.excludeAmazonSeller || !p.amazonSells) &&
      (!opts.subcategories?.length || opts.subcategories.includes(p.subcategory)) &&
      (!opts.excludePrivateLabel || !isLikelyPrivateLabel(p))
  );
}

function postFilter(products, opts) {
  return products.filter((p) => {
    const roi = parseFloat(p.profitData?.roi ?? 0);
    const profit = parseFloat(p.profitData?.profit ?? 0);
    if (roi < opts.minROI) return false;
    if (profit < opts.minProfit) return false;
    if (opts.excludeRestricted && p.profitData?.restricted) return false;
    if (opts.excludeHazmat && p.profitData?.hazmat) return false;
    return true;
  });
}

// Scan a single Amazon category for profitable sourcing leads.
async function scanCategory(categoryName, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!CATEGORY_IDS[categoryName]) {
    throw new Error(`Unknown category: "${categoryName}". Valid: ${Object.keys(CATEGORY_IDS).join(", ")}`);
  }

  console.log(`[Scanner] Scanning category: ${categoryName}`);
  const allAsins = [];

  for (let page = 0; page < opts.pages; page++) {
    const asins = await searchCategory(categoryName, opts.minPrice, opts.maxPrice, page);
    allAsins.push(...asins);
    if (asins.length < 50) break;
  }

  if (!allAsins.length) {
    console.log(`[Scanner] No ASINs found in ${categoryName}`);
    return [];
  }

  console.log(`[Scanner] ${allAsins.length} ASINs found — fetching details...`);
  const products = await fetchDetails(allAsins);

  // Cheap filters (price/BSR/rating/reviews/sellers/units — all free, already on hand from
  // Keepa) run BEFORE the paid BSR refresh and profit lookup, so we never spend SP-API or
  // SellerAmp calls on products that were going to be dropped anyway.
  const preFiltered = preFilter(products, opts);
  console.log(`[Scanner] ${preFiltered.length}/${products.length} pass pre-filter — refreshing BSR + calculating profit...`);

  const withBsr = await enrichBsr(preFiltered);
  const enriched = await batchCalculate(withBsr);
  const profitable = postFilter(enriched, opts);

  const scored = scoreProducts(profitable);
  const leads = filterByGrade(scored, opts.minGrade);

  const tagged = leads.map((p) => ({ ...p, category: categoryName, scannedAt: new Date().toISOString() }));

  console.log(`[Scanner] ${leads.length} leads found in ${categoryName} — checking ungating...`);
  const withUngating = await batchCheckUngating(tagged);

  console.log(`[Scanner] Ungating check complete for ${categoryName}`);
  return withUngating;
}

// Scan multiple categories sequentially and return a merged, re-ranked list.
// If some (but not all) categories fail, the failures are attached as a
// `.partialErrors` property on the returned array rather than thrown, so a
// partial result set doesn't get discarded — callers that only care about the
// leads (e.g. the scheduler) can keep treating the return value as a plain
// array; callers that want to surface the failure (e.g. the API route) can
// check `result.partialErrors`.
async function scanMultipleCategories(categories = Object.keys(CATEGORY_IDS), options = {}) {
  const allLeads = [];
  const errors   = [];
  // No per-call Map needed here anymore — fetchDetails' disk cache (keepaCache.js)
  // already dedupes an ASIN that shows up under more than one category, and does
  // so across scans/restarts too, not just within this one call.

  for (const category of categories) {
    try {
      const leads = await scanCategory(category, options);
      allLeads.push(...leads);
    } catch (err) {
      console.error(`[Scanner] Error scanning ${category}: ${err.message}`);
      errors.push({ category, message: err.message });
    }
  }

  // If every category failed, surface the first error instead of returning empty results silently
  if (errors.length > 0 && allLeads.length === 0) {
    throw new Error(errors[0].message);
  }

  const result = scoreProducts(allLeads);
  if (errors.length > 0) {
    result.partialErrors = errors;
  }
  return result;
}

// Scan a pre-loaded supplier product list (output of supplier.matchSupplierToAmazon)
async function scanSupplierProducts(supplierProducts, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const matched = getMatched(supplierProducts);

  if (!matched.length) {
    console.log("[Scanner] No matched supplier products to scan");
    return [];
  }

  console.log(`[Scanner] Scanning ${matched.length} supplier products...`);
  const asins = matched.map((p) => p.asin);
  const products = await fetchDetails(asins);

  // Attach supplier cost data to each product
  const merged = products.map((p) => {
    const supplier = matched.find((s) => s.asin === p.asin);
    return {
      ...p,
      sourcePrice: supplier?.cost,
      supplierName: supplier?.name,
      supplierSku: supplier?.sku,
      supplierSource: supplier?.source,
    };
  });

  const preFiltered = preFilter(merged, opts);
  console.log(`[Scanner] ${preFiltered.length}/${merged.length} pass pre-filter — refreshing BSR + calculating profit...`);

  const withBsr = await enrichBsr(preFiltered);
  const enriched = await batchCalculate(withBsr);
  const profitable = postFilter(enriched, opts);
  const scored = scoreProducts(profitable);

  const leads = filterByGrade(scored, opts.minGrade).map((p) => ({
    ...p,
    scannedAt: new Date().toISOString(),
    scanType: "supplier",
  }));

  return batchCheckUngating(leads);
}

// Quick single-ASIN analysis. `options`, when passed (e.g. the frontend's active scan
// filters), is checked against the same hard gates scanCategory uses — the result is still
// returned so a direct ASIN lookup never comes back empty with no explanation, but it's
// flagged when it wouldn't have survived the current filter set.
async function scanAsin(asin, buyPrice = null, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  console.log(`[Scanner] Scanning ASIN: ${asin}`);
  const [rawProduct] = await getProductDetails([asin]);
  if (!rawProduct) throw new Error(`ASIN not found: ${asin}`);
  const passesPreFilter = preFilter([rawProduct], opts).length > 0;

  const [product] = await enrichBsr([rawProduct]);
  const [enriched] = await batchCalculate([{ ...product, sourcePrice: buyPrice }]);
  const passesPostFilter = postFilter([enriched], opts).length > 0;

  const [scored] = scoreProducts([enriched]);
  const [withUngating] = await batchCheckUngating([scored]);

  if (passesPreFilter && passesPostFilter) return withUngating;
  return {
    ...withUngating,
    flags: [...(withUngating.flags || []), "Outside your active scan filters (price/ROI/BSR/etc.)"],
  };
}

module.exports = {
  scanCategory,
  scanMultipleCategories,
  scanSupplierProducts,
  scanAsin,
  DEFAULT_OPTIONS,
};
