const { searchCategory, getProductDetails, CATEGORY_IDS } = require("./keepa");
const { batchCalculate } = require("./selleramp");
const { scoreProducts, filterByGrade } = require("./scorer");
const { getMatched } = require("./supplier");
const { batchCheckUngating } = require("./spapi");

const KEEPA_BATCH_SIZE = 20; // Keepa max ASINs per request

const DEFAULT_OPTIONS = {
  minPrice: 10,
  maxPrice: 70,
  minROI: 30,
  minProfit: 3,
  minRating: 3.8,
  maxBSR: 50000,
  minReviews: 10,
  minGrade: "B",
  pages: 2,
  excludeRestricted: true,
  excludeHazmat: true,
};

// Fetch Keepa product details in batches of 20
async function fetchDetails(asins) {
  const products = [];
  for (let i = 0; i < asins.length; i += KEEPA_BATCH_SIZE) {
    const batch = asins.slice(i, i + KEEPA_BATCH_SIZE);
    const details = await getProductDetails(batch);
    products.push(...details);
  }
  return products;
}

function preFilter(products, opts) {
  return products.filter(
    (p) =>
      p.price >= opts.minPrice &&
      p.price <= opts.maxPrice &&
      p.bsr <= opts.maxBSR &&
      // Skip rating/review checks when Keepa has no data — don't penalise missing stats
      (p.rating  == null || p.rating  >= opts.minRating) &&
      (p.reviews == null || p.reviews >= opts.minReviews)
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

// Scan a single Amazon category for profitable sourcing leads
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
  const preFiltered = preFilter(products, opts);

  console.log(`[Scanner] ${preFiltered.length}/${products.length} pass pre-filter — calculating profit...`);
  const enriched = await batchCalculate(preFiltered);
  const profitable = postFilter(enriched, opts);

  const scored = scoreProducts(profitable);
  const leads = filterByGrade(scored, opts.minGrade);

  const tagged = leads.map((p) => ({ ...p, category: categoryName, scannedAt: new Date().toISOString() }));

  console.log(`[Scanner] ${leads.length} leads found in ${categoryName} — checking ungating...`);
  const withUngating = await batchCheckUngating(tagged);

  console.log(`[Scanner] Ungating check complete for ${categoryName}`);
  return withUngating;
}

// Scan multiple categories sequentially and return a merged, re-ranked list
async function scanMultipleCategories(categories = Object.keys(CATEGORY_IDS), options = {}) {
  const allLeads = [];
  const errors   = [];

  for (const category of categories) {
    try {
      const leads = await scanCategory(category, options);
      allLeads.push(...leads);
    } catch (err) {
      console.error(`[Scanner] Error scanning ${category}: ${err.message}`);
      errors.push(err);
    }
  }

  // If every category failed, surface the first error instead of returning empty results silently
  if (errors.length > 0 && allLeads.length === 0) {
    throw errors[0];
  }

  return scoreProducts(allLeads);
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
  console.log(`[Scanner] ${preFiltered.length}/${merged.length} pass pre-filter — calculating profit...`);

  const enriched = await batchCalculate(preFiltered);
  const profitable = postFilter(enriched, opts);
  const scored = scoreProducts(profitable);

  const leads = filterByGrade(scored, opts.minGrade).map((p) => ({
    ...p,
    scannedAt: new Date().toISOString(),
    scanType: "supplier",
  }));

  return batchCheckUngating(leads);
}

// Quick single-ASIN analysis
async function scanAsin(asin, buyPrice = null) {
  console.log(`[Scanner] Scanning ASIN: ${asin}`);
  const [product] = await getProductDetails([asin]);
  if (!product) throw new Error(`ASIN not found: ${asin}`);

  const [enriched] = await batchCalculate([{ ...product, sourcePrice: buyPrice }]);
  const [scored] = scoreProducts([enriched]);
  const [withUngating] = await batchCheckUngating([scored]);
  return withUngating;
}

module.exports = {
  scanCategory,
  scanMultipleCategories,
  scanSupplierProducts,
  scanAsin,
  DEFAULT_OPTIONS,
};
