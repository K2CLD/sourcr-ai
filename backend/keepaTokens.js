const fs = require("fs");
const path = require("path");

// Keepa token accounting for scan cost estimates. Instead of hardcoding what calls cost,
// every Keepa response's real `tokensConsumed` is recorded as a rolling average per call
// type, along with how many ASINs each category's search actually returns. Persisted so
// estimates keep improving across scans and app restarts.
// SOURCR_DATA_DIR is set by the packaged app (electron/main.js) — database/ is read-only there.
const STATS_FILE = path.join(process.env.SOURCR_DATA_DIR || path.join(__dirname, "..", "database"), "keepa-token-stats.json");
const WINDOW = 20; // samples kept per rolling average

// Used only until real samples exist.
const DEFAULT_COSTS = {
  categoryQuery: 50, // all Product Finder (/query) calls for ONE category scan, summed across pages
  perAsin: 1,        // one ASIN in a basic /product call (stats + history cost nothing extra)
  perAsinFull: 4,    // one ASIN with buybox=1 + rating=1 (measured: 1 + 2 buybox + 1 rating)
};
const DEFAULT_ASINS_PER_CATEGORY = 100;
// How many of a category's ASINs survive the basic filters and get the full (Buy Box)
// fetch — measured 23–29 of ~90 on a kitchen scan before real data exists.
const DEFAULT_FULL_ASINS_PER_CATEGORY = 30;

let stats = null;

function load() {
  if (stats) return stats;
  try {
    stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch {
    stats = {};
  }
  stats.calls = { categoryQuery: [], perAsin: [], perAsinFull: [], ...stats.calls };
  stats.asinsPerCategory = stats.asinsPerCategory || {};
  stats.fullAsinsPerCategory = stats.fullAsinsPerCategory || {};
  return stats;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats));
  } catch (err) {
    console.warn(`[Tokens] Could not persist token stats: ${err.message}`);
  }
}

function push(list, value) {
  list.push(value);
  if (list.length > WINDOW) list.splice(0, list.length - WINDOW);
}

const average = (list) => (list?.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

// tokensConsumed summed over every /query page of one category scan
function recordCategoryQuery(category, tokensConsumed, asinCount) {
  const s = load();
  if (Number.isFinite(tokensConsumed)) push(s.calls.categoryQuery, tokensConsumed);
  if (category && Number.isFinite(asinCount)) {
    s.asinsPerCategory[category] = s.asinsPerCategory[category] || [];
    push(s.asinsPerCategory[category], asinCount);
  }
  console.log(`[Tokens] ${category} category query: ${tokensConsumed} tokens, ${asinCount} ASINs returned`);
  save();
}

// type: "perAsin" (basic fetch) or "perAsinFull" (buybox + rating)
function recordProductLookup(tokensConsumed, asinCount, type = "perAsin") {
  if (!Number.isFinite(tokensConsumed) || !asinCount) return;
  push(load().calls[type], tokensConsumed / asinCount);
  console.log(`[Tokens] ${type === "perAsinFull" ? "full" : "basic"} product lookup: ${tokensConsumed} tokens for ${asinCount} ASIN(s)`);
  save();
}

// How many of a category scan's ASINs needed the full fetch
function recordFullAsins(category, asinCount) {
  if (!category || !Number.isFinite(asinCount)) return;
  const s = load();
  s.fullAsinsPerCategory[category] = s.fullAsinsPerCategory[category] || [];
  push(s.fullAsinsPerCategory[category], asinCount);
  save();
}

function getCosts() {
  const s = load();
  const cost = (type) => {
    const avg = average(s.calls[type]);
    return avg == null
      ? { value: DEFAULT_COSTS[type], samples: 0, source: "default" }
      : { value: avg, samples: s.calls[type].length, source: "measured" };
  };
  return { categoryQuery: cost("categoryQuery"), perAsin: cost("perAsin"), perAsinFull: cost("perAsinFull") };
}

// `category` null = not known yet (AI-picked trending scan) — uses the mean across every
// category with history.
function expectedFrom(byCategory, category, fallback) {
  if (category && byCategory[category]?.length) return average(byCategory[category]);
  const perCategory = Object.values(byCategory).map(average).filter((v) => v != null);
  return perCategory.length ? average(perCategory) : fallback;
}

function expectedAsins(category) {
  return expectedFrom(load().asinsPerCategory, category, DEFAULT_ASINS_PER_CATEGORY);
}

function expectedFullAsins(category) {
  return expectedFrom(load().fullAsinsPerCategory, category, DEFAULT_FULL_ASINS_PER_CATEGORY);
}

function estimateCategoryCost(category) {
  const { categoryQuery, perAsin, perAsinFull } = getCosts();
  return Math.ceil(
    categoryQuery.value +
    expectedAsins(category) * perAsin.value +
    expectedFullAsins(category) * perAsinFull.value
  );
}

// Keepa's bucket holds at most one hour of refill.
const maxBucket = (refillRate) => (refillRate > 0 ? refillRate * 60 : null);

// categories: names, or nulls for not-yet-picked trending categories.
function estimateScan(categories, tokenState) {
  const perCategory = categories.map((c) => ({ category: c, tokens: estimateCategoryCost(c) }));
  const needed = perCategory.reduce((sum, c) => sum + c.tokens, 0);
  const tokensLeft = tokenState.tokensLeft;
  const refillRate = tokenState.refillRate;
  const enough = tokensLeft != null && tokensLeft >= needed;
  const deficit = Math.max(0, needed - (tokensLeft ?? 0));
  const waitMinutes = enough ? 0 : refillRate > 0 ? Math.ceil(deficit / refillRate) : null;
  const bucket = maxBucket(refillRate);
  // A scan bigger than a full bucket can never be paid for up front — the scanner runs it
  // category by category, pausing for refills in between (see scanner.js waitForTokens).
  const batched = bucket != null && needed > bucket;

  return {
    tokensLeft,
    needed,
    enough,
    refillRate,
    waitMinutes,
    batched,
    totalMinutes: batched ? waitMinutes : null,
    maxBucket: bucket,
    perCategory,
    costs: getCosts(),
  };
}

module.exports = {
  recordCategoryQuery,
  recordProductLookup,
  recordFullAsins,
  getCosts,
  expectedAsins,
  estimateCategoryCost,
  estimateScan,
  maxBucket,
};
