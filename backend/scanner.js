const { searchCategory, getProductDetails, getCategoryTree, getFreshTokenState, fetchTokenStatus, CATEGORY_IDS } = require("./keepa");
const { batchCalculateProfit } = require("./profit");
const { scoreProducts, filterByGrade } = require("./scorer");
const { getMatched } = require("./supplier");
const { batchCheckUngating, batchGetSalesRanks, hasCredentials } = require("./spapi");
const { analyzeLeads, pickTrendingCategories } = require("./ai");
const keepaCache = require("./keepaCache");
const keepaTokens = require("./keepaTokens");
const { createFunnel } = require("./funnel");

const KEEPA_BATCH_SIZE = 100; // Keepa's actual /product limit (was wrongly set to 20 — 5x more requests than needed)
const SEARCH_PAGE_SIZE = 200; // Product Finder page size — see keepa.js searchCategory

const DEFAULT_OPTIONS = {
  minPrice: 10,
  maxPrice: 70,
  minROI: 30,
  minProfit: 3,
  minRating: 4.0,
  maxBSR: 50000,
  minReviews: 10,
  minGrade: "B",
  maxAsinsPerCategory: 200, // per search unit (a category, or one selected subcategory)
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
// `full` fetches Buy Box + rating data (~4 tokens/ASIN instead of 1) — see keepa.js.
async function fetchDetails(asins, funnel = null, { full = false } = {}) {
  const unique = [...new Set(asins)];
  const fromCache = [];
  const toFetch = [];
  const cacheKey = (asin) => (full ? `${asin}:full` : asin);

  for (const asin of unique) {
    const cached = keepaCache.get(cacheKey(asin));
    if (cached) fromCache.push(cached);
    else toFetch.push(asin);
  }

  const freshlyFetched = [];
  const nullDropped = []; // { asin, fields } — returned by Keepa but missing price/BSR
  for (let i = 0; i < toFetch.length; i += KEEPA_BATCH_SIZE) {
    const batch = toFetch.slice(i, i + KEEPA_BATCH_SIZE);
    const details = await getProductDetails(batch, { full, onDrop: (asin, fields) => nullDropped.push({ asin, fields }) });
    freshlyFetched.push(...details);
    details.forEach((d) => keepaCache.set(cacheKey(d.asin), d));
  }
  keepaCache.flush();

  const products = [...fromCache, ...freshlyFetched];

  if (funnel) {
    const returned = new Set(products.map((p) => p.asin));
    const nulls = new Set(nullDropped.map((d) => d.asin));
    const rejected = [
      ...nullDropped.map((d) => ({ asin: d.asin, reason: `missing ${d.fields.join(" + ")} in Keepa data`, missing: d.fields })),
      ...unique
        .filter((a) => !returned.has(a) && !nulls.has(a))
        .map((a) => ({ asin: a, reason: "not returned by Keepa /product" })),
    ];
    const dupes = asins.length - unique.length;
    funnel.stage(full ? "keepa:buybox-details" : "keepa:details", unique.length, products.length, rejected,
      `${fromCache.length} cached, ${toFetch.length} fetched${dupes ? `, ${dupes} duplicate ASIN(s) across search pages` : ""}`);
  }

  return products;
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

// ─── Filters ──────────────────────────────────────────────────────────────────
// Each filter is a list of individually named checks so the funnel can report exactly
// which criterion dropped each ASIN. A check returns:
//   null                     — pass
//   { skip: "field" }        — data missing, check skipped (NOT a drop)
//   { reason, missing? }     — fail; `missing` marks a drop caused by null data

const fail = (reason, missing) => ({ reason, ...(missing ? { missing } : {}) });

// Checks on data from the cheap (1 token/ASIN) Keepa fetch — run first, so the ~4-token
// Buy Box fetch is only spent on products that can still make it.
const BASIC_CHECKS = [
  // null BSR passes, as it always has (null <= maxBSR is true in JS) — keepa.js already
  // drops products with no BSR, so this only matters for data from elsewhere.
  ["bsr", (p, o) =>
    p.bsr == null ? { skip: "BSR" } :
    p.bsr > o.maxBSR ? fail(`BSR ${p.bsr} > max ${o.maxBSR}`) : null],
  // Seller/units checks are skipped when Keepa has no data — don't penalise missing stats
  ["sellers", (p, o) =>
    p.sellerCount == null ? { skip: "seller count" } :
    p.sellerCount > o.maxSellers ? fail(`${p.sellerCount} sellers > max ${o.maxSellers}`) : null],
  ["monthly-units", (p, o) =>
    p.monthlySold == null ? { skip: "sales estimate (Keepa monthlySold)" } :
    p.monthlySold < o.minMonthlyUnits ? fail(`${p.monthlySold} units/mo < min ${o.minMonthlyUnits}`) : null],
  ["amazon-seller", (p, o) =>
    o.excludeAmazonSeller && p.amazonSells ? fail("Amazon sells on this listing") : null],
  // Matches any level of the product's category path: the picker sends names one level
  // below the root, but p.subcategory is the deepest leaf (e.g. "Tumblers & Water Glasses"
  // under "Travel & To-Go Drinkware") — comparing only the leaf dropped nearly everything.
  ["subcategory", (p, o) =>
    o.subcategories?.length && ![p.subcategory, ...(p.categoryPath || [])].some((n) => o.subcategories.includes(n))
      ? fail(`category path "${(p.categoryPath || [p.subcategory]).join(" > ")}" not in selected subcategories`) : null],
  ["private-label", (p, o) =>
    o.excludePrivateLabel && isLikelyPrivateLabel(p)
      ? fail(`likely private label (sole seller now/30d/90d: ${p.sellerCount}/${p.sellerCount30 ?? "-"}/${p.sellerCount90 ?? "-"})`) : null],
];

// Checks that need the full fetch: Buy Box price (index 18) and rating/reviews (rating=1)
const BUYBOX_CHECKS = [
  ["price", (p, o) =>
    p.price == null ? fail("no Buy Box price", ["Buy Box price"]) :
    p.price < o.minPrice ? fail(`Buy Box ${p.price} < min ${o.minPrice}`) :
    p.price > o.maxPrice ? fail(`Buy Box ${p.price} > max ${o.maxPrice}`) : null],
  // Rating/review checks are skipped when Keepa has no data — don't penalise missing stats
  ["rating", (p, o) =>
    p.rating == null ? { skip: "rating" } :
    p.rating < o.minRating ? fail(`rating ${p.rating} < min ${o.minRating}`) : null],
  ["reviews", (p, o) =>
    p.reviews == null ? { skip: "review count" } :
    p.reviews < o.minReviews ? fail(`${p.reviews} reviews < min ${o.minReviews}`) : null],
];

// Last gates before Claude: no AI tokens spent on a lead that fails any of these. ROI and
// profit are already enforced by the post-filter (on real SP-API fees), and ungating by
// filterByUngating — these are the two remaining hard requirements.
const AI_GATE_CHECKS = [
  ["private-label", (p) =>
    isLikelyPrivateLabel(p) ? fail("likely private label (hard gate — ignores the Exclude Private Label toggle)") : null],
  ["monthly-sales", (p, o) =>
    p.monthlySold == null ? fail("no monthly sales estimate", ["sales estimate"]) :
    p.monthlySold < o.minMonthlyUnits ? fail(`${p.monthlySold} units/mo < min ${o.minMonthlyUnits}`) : null],
];

// Missing ROI/profit is treated as 0, as before — it fails unless the threshold is <= 0.
function numericCheck(field, label, unitFmt, minKey) {
  return (p, o) => {
    const n = parseFloat(p.profitData?.[field]);
    if (!Number.isFinite(n)) return 0 < o[minKey] ? fail(`missing ${label} from profit calc`, [label]) : null;
    return n < o[minKey] ? fail(`${label} ${unitFmt(n)} < min ${unitFmt(o[minKey])}`) : null;
  };
}

// Listing restrictions are checked by SP-API ungating, not here.
const POST_FILTER_CHECKS = [
  ["roi", numericCheck("roi", "ROI", (v) => `${v}%`, "minROI")],
  ["profit", numericCheck("profit", "profit", (v) => `${v}`, "minProfit")],
  ["hazmat", (p, o) => (o.excludeHazmat && p.profitData?.hazmat ? fail("hazmat (Keepa hazardousMaterials)") : null)],
];

// Runs checks in order as a sequential funnel: each check is its own stage with its own
// in/out count. A rejected ASIN is attributed to the FIRST check it fails; any later
// checks it would also have failed are listed in its reason.
function runChecks(products, checks, opts, funnel, prefix) {
  const evaluated = products.map((p) => ({ p, outcomes: checks.map(([, check]) => check(p, opts)) }));

  if (funnel) {
    for (const { outcomes } of evaluated) {
      for (const o of outcomes) if (o?.skip) funnel.missing(o.skip);
    }
  }

  let surviving = evaluated;
  checks.forEach(([name], i) => {
    const next = [];
    const rejected = [];
    for (const e of surviving) {
      const o = e.outcomes[i];
      if (!o?.reason) { next.push(e); continue; }
      const also = e.outcomes.slice(i + 1).filter((x) => x?.reason).map((x) => x.reason);
      rejected.push({
        asin: e.p.asin,
        reason: o.reason + (also.length ? ` [also fails: ${also.join("; ")}]` : ""),
        missing: o.missing,
      });
    }
    funnel?.stage(`${prefix}:${name}`, surviving.length, next.length, rejected);
    surviving = next;
  });

  return surviving.map((e) => e.p);
}

// Every pre-profit check at once — for callers that already hold full product data (scanAsin)
function preFilter(products, opts, funnel = null) {
  return runChecks(products, [...BASIC_CHECKS, ...BUYBOX_CHECKS], opts, funnel, "pre-filter");
}

function postFilter(products, opts, funnel = null) {
  return runChecks(products, POST_FILTER_CHECKS, opts, funnel, "post-filter");
}

// Runs after batchCheckUngating — keeps only leads SP-API confirmed as fully open
// (gated === false). Any restriction at all fails this gate, regardless of whether
// Amazon offers a "request approval" link (that link means an application process
// exists, not that one can be skipped — see spapi.js checkViaSpApi). Unknown status
// (gated === null) also fails: "confirmed open" means confirmed, not unconfirmed.
// This is a hard, unconditional gate — there is no options flag to disable it.
function filterByUngating(products) {
  return products.filter((p) => p.ungating?.gated === false);
}

// Gated, but only because brand/category approval is needed and Amazon offers a way to
// request it (APPROVAL_REQUIRED + a request link) — as opposed to a hard block such as
// NOT_ELIGIBLE. These still fail the "sellable today" gate and never reach the AI scorer;
// they're returned in a separate list so the user can decide whether to apply.
function isApprovalRequestable(u) {
  const codes = u?.reasonCodes || [];
  return u?.gated === true && !!u.approvalUrl && codes.includes("APPROVAL_REQUIRED") && !codes.includes("NOT_ELIGIBLE");
}

function ungatingReason(u) {
  if (!u) return "no ungating result";
  if (!u.gated) return `status unknown (${u.method}): ${u.notes}`;
  const codes = u.reasonCodes?.length ? ` [${u.reasonCodes.join(", ")}]` : "";
  const link = u.approvalUrl ? " — approval can be requested" : "";
  return `gated (${u.method})${codes}: ${u.notes}${link}`;
}

// Everything after Keepa: pre-filter → BSR refresh → profit calc → post-filter → grade →
// ungating → AI. Shared by category and supplier scans; every stage reports to `funnel`.
// `tag` is merged into each lead that reaches the ungating check.
// One product per variation family (Keepa parentAsin): the best-selling variant, by BSR.
// Runs before the ~4-token Buy Box fetch so tokens aren't spent on near-identical colour /
// size variants. finalizeScan still dedupes by AI rank later (variants across categories).
function dedupeVariantsByBsr(products, funnel) {
  const best = new Map();
  for (const p of products) {
    const key = p.parentAsin || p.asin;
    const cur = best.get(key);
    if (!cur || (p.bsr ?? Infinity) < (cur.bsr ?? Infinity)) best.set(key, p);
  }
  const kept = new Set(best.values());
  funnel.stage("dedupe:variants-pre-fetch", products.length, kept.size,
    products.filter((p) => !kept.has(p)).map((p) => {
      const winner = best.get(p.parentAsin || p.asin);
      return { asin: p.asin, reason: `variant of parent ${p.parentAsin} — kept ${winner.asin} (BSR ${winner.bsr ?? "-"} vs ${p.bsr ?? "-"})` };
    }));
  return products.filter((p) => kept.has(p));
}

async function runPipeline(products, opts, funnel, tag) {
  const basicPassed = dedupeVariantsByBsr(runChecks(products, BASIC_CHECKS, opts, funnel, "pre-filter"), funnel);

  // Buy Box + rating data (~4 tokens/ASIN) only for what survived the cheap checks. Merged
  // over the basic product so caller-attached fields (supplier cost etc.) survive.
  const full = await fetchDetails(basicPassed.map((p) => p.asin), funnel, { full: true });
  if (tag.category) keepaTokens.recordFullAsins(tag.searchScope || tag.category, basicPassed.length, products.length);
  const basicByAsin = new Map(basicPassed.map((p) => [p.asin, p]));
  const merged = full.map((p) => ({ ...basicByAsin.get(p.asin), ...p }));
  const preFiltered = runChecks(merged, BUYBOX_CHECKS, opts, funnel, "buybox-filter");

  // Cheap filters above run BEFORE the BSR refresh and fee lookup, so we never spend
  // SP-API calls on products that were going to be dropped anyway.
  const withBsr = await enrichBsr(preFiltered);
  const refreshed = withBsr.filter((p) => p.bsrSource === "sp-api").length;
  funnel.stage("sp-api:bsr-refresh", preFiltered.length, withBsr.length, [],
    `${refreshed} refreshed via SP-API, ${withBsr.length - refreshed} kept Keepa BSR; refreshed BSR is not re-checked against max BSR`);

  const enriched = await batchCalculateProfit(withBsr);
  const realFees = enriched.filter((p) => p.profitData?.feeSource === "sp-api").length;
  const assumedCost = enriched.filter((p) => p.profitData?.buyCostAssumed).length;
  funnel.stage("sp-api:fees", withBsr.length, enriched.length, [],
    `${realFees} real Amazon fees, ${enriched.length - realFees} fee-table estimate; ${assumedCost} with assumed buy cost`);

  const profitable = postFilter(enriched, opts, funnel);

  const scored = scoreProducts(profitable);
  const leads = filterByGrade(scored, opts.minGrade);
  const kept = new Set(leads);
  funnel.stage(`scorer:grade>=${opts.minGrade}`, scored.length, leads.length,
    scored.filter((p) => !kept.has(p)).map((p) => ({
      asin: p.asin,
      reason: `grade ${p.grade} (score ${p.score}) < min ${opts.minGrade}${p.flags.length ? `; flags: ${p.flags.join(", ")}` : ""}`,
    })));

  const scannedAt = new Date().toISOString();
  const tagged = leads.map((p) => ({ ...p, ...tag, scannedAt }));

  const withUngating = await batchCheckUngating(tagged);
  const sellableToday = filterByUngating(withUngating);
  const methodCounts = withUngating.reduce((acc, p) => {
    const m = p.ungating?.method || "error";
    acc[m] = (acc[m] || 0) + 1;
    return acc;
  }, {});
  // Approval-requestable leads go to their own list — but only ones that would otherwise
  // qualify (a private-label or no-sales listing isn't worth applying for).
  const approvalCandidates = withUngating.filter((p) => isApprovalRequestable(p.ungating));
  const approvalRequired = runChecks(approvalCandidates, AI_GATE_CHECKS, opts, null, "approval-gate");
  funnel.stage("sp-api:restrictions", withUngating.length, sellableToday.length,
    withUngating.filter((p) => p.ungating?.gated !== false).map((p) => ({ asin: p.asin, reason: ungatingReason(p.ungating) })),
    `methods: ${Object.entries(methodCounts).map(([m, n]) => `${m} ${n}`).join(", ") || "none"}; ${approvalRequired.length} approval-requestable listed separately`);

  const aiReady = runChecks(sellableToday, AI_GATE_CHECKS, opts, funnel, "ai-gate");

  const withAiAnalysis = await analyzeLeads(aiReady);
  const aiErrors = withAiAnalysis.filter((p) => p.aiAnalysis?.error).length;
  funnel.stage("ai:analysis", aiReady.length, withAiAnalysis.length, [],
    aiErrors ? `${aiErrors} AI error(s) — kept, ranked last` : "");

  return attachMeta(withAiAnalysis, { approvalRequired });
}

// Scan metadata rides on the leads array as non-enumerable properties, so it never leaks
// into JSON responses, saved scans, or spreads: .funnel and .approvalRequired.
function attachMeta(leads, meta) {
  for (const [key, value] of Object.entries(meta)) {
    Object.defineProperty(leads, key, { value, enumerable: false, configurable: true });
  }
  return leads;
}

function attachFunnel(leads, funnel) {
  return attachMeta(leads, { funnel });
}

// ─── Keepa token budgeting ────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pauses until the Keepa bucket can cover this category's estimated cost (capped at a
// full bucket, so a category bigger than the bucket still runs once it's full). This is
// what lets a scan larger than the plan's bucket run in batches instead of failing midway.
async function waitForTokens(category, cap = null) {
  const needed = keepaTokens.estimateCategoryCost(category, cap);
  for (;;) {
    let state;
    try {
      state = await getFreshTokenState(15000);
    } catch (err) {
      console.warn(`[Tokens] Could not read Keepa token status (${err.message}) — continuing without waiting`);
      return;
    }
    const target = Math.min(needed, keepaTokens.maxBucket(state.refillRate) ?? needed);
    if (state.tokensLeft == null || state.tokensLeft >= target || !(state.refillRate > 0)) return;

    const waitMs = Math.ceil((target - state.tokensLeft) / state.refillRate) * 60000;
    console.log(`[Tokens] ${category}: need ~${target} tokens, have ${state.tokensLeft} — pausing ${Math.round(waitMs / 60000)} min for refill`);
    await sleep(waitMs);
    await fetchTokenStatus().catch(() => {});
  }
}

// What one root category is searched as: the whole category, or — when only some of its
// subcategories are selected — each selected subcategory's own Keepa node, so each gets its
// own ASIN budget. (Searching the root and filtering afterwards spent most of the budget on
// subcategories nobody selected, e.g. Birds and Horses in a Cats/Dogs pet scan.)
async function searchUnits(categoryName, subcategories) {
  const root = { label: categoryName, nodeIds: [CATEGORY_IDS[categoryName]] };
  if (!subcategories?.length) return [root];
  let children;
  try {
    children = (await getCategoryTree())[categoryName]?.children || [];
  } catch (err) {
    console.warn(`[Scanner] Category tree unavailable (${err.message}) — searching ${categoryName} whole`);
    return [root];
  }
  const picked = children.filter((c) => subcategories.includes(c.name));
  if (!picked.length || picked.length === children.length) return [root];
  return picked.map((c) => ({ label: `${categoryName} > ${c.name}`, nodeIds: [c.id] }));
}

// Estimate a scan's Keepa cost against current tokens. `categories` are names; pass
// `trendingCount` instead for an AI-picked scan whose categories aren't known yet.
async function preflightTokens({ categories = [], subcategories = [], trendingCount = 0, maxAsinsPerCategory = DEFAULT_OPTIONS.maxAsinsPerCategory } = {}) {
  const units = [];
  for (const c of categories) units.push(...(await searchUnits(c, subcategories)).map((u) => u.label));
  const targets = [...units, ...Array(trendingCount).fill(null)];
  const state = await getFreshTokenState();
  return keepaTokens.estimateScan(targets, state, maxAsinsPerCategory);
}

// ─── Scans ────────────────────────────────────────────────────────────────────

// Scan one search unit (see searchUnits): pull up to opts.maxAsinsPerCategory ASINs from
// Keepa, then run the full pipeline. Funnel rows are labelled with the unit.
async function scanUnit(categoryName, unit, opts) {
  const funnel = createFunnel(unit.label);
  try {
    await waitForTokens(unit.label, opts.maxAsinsPerCategory);

    console.log(`[Scanner] Scanning ${unit.label} (node ${unit.nodeIds.join(",")}), up to ${opts.maxAsinsPerCategory} ASINs`);
    const allAsins = [];
    let queryTokens = 0;
    let pagesFetched = 0;
    let totalResults = null;

    while (allAsins.length < opts.maxAsinsPerCategory) {
      const res = await searchCategory(unit.nodeIds, opts, pagesFetched, SEARCH_PAGE_SIZE);
      allAsins.push(...res.asins);
      queryTokens += res.tokensConsumed ?? 0;
      totalResults = res.totalResults;
      pagesFetched++;
      if (res.asins.length < SEARCH_PAGE_SIZE) break; // Keepa has no more matches
    }
    const pulled = allAsins.slice(0, opts.maxAsinsPerCategory);
    keepaTokens.recordCategoryQuery(unit.label, queryTokens, new Set(pulled).size, totalResults);
    funnel.stage("keepa:search", null, pulled.length, [],
      `Keepa matched ${totalResults ?? "?"}; ${pagesFetched} page(s), ${queryTokens} tokens, cap ${opts.maxAsinsPerCategory}`);

    if (!pulled.length) return attachFunnel([], funnel);

    const products = await fetchDetails(pulled, funnel);
    const leads = await runPipeline(products, opts, funnel, { category: categoryName, searchScope: unit.label });
    console.log(`[Scanner] Scan complete for ${unit.label}`);
    return attachFunnel(leads, funnel);
  } catch (err) {
    err.funnel = funnel; // keep the partial funnel so the summary shows how far it got
    throw err;
  }
}

// Scan a single Amazon category for profitable sourcing leads. The returned array carries
// the scan's funnel as a non-enumerable `.funnel` property (see finalizeScan).
async function scanCategory(categoryName, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!CATEGORY_IDS[categoryName]) {
    throw new Error(`Unknown category: "${categoryName}". Valid: ${Object.keys(CATEGORY_IDS).join(", ")}`);
  }

  const units = await searchUnits(categoryName, opts.subcategories);
  if (units.length === 1) return scanUnit(categoryName, units[0], opts);

  // Several selected subcategories: one search (and ASIN budget) each, merged
  const funnel = createFunnel(categoryName);
  const leads = [];
  const approvalRequired = [];
  for (const unit of units) {
    try {
      const unitLeads = await scanUnit(categoryName, unit, opts);
      funnel.absorb(unitLeads.funnel);
      leads.push(...unitLeads);
      approvalRequired.push(...(unitLeads.approvalRequired || []));
    } catch (err) {
      funnel.absorb(err.funnel);
      err.funnel = funnel;
      throw err;
    }
  }
  return attachMeta(leads, { funnel, approvalRequired });
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
  const approvalRequired = [];
  const errors   = [];
  const funnel   = createFunnel("scan");
  // No per-call Map needed here anymore — fetchDetails' disk cache (keepaCache.js)
  // already dedupes an ASIN that shows up under more than one category, and does
  // so across scans/restarts too, not just within this one call.

  for (const category of categories) {
    try {
      const leads = await scanCategory(category, options);
      funnel.absorb(leads.funnel);
      allLeads.push(...leads);
      approvalRequired.push(...(leads.approvalRequired || []));
    } catch (err) {
      console.error(`[Scanner] Error scanning ${category}: ${err.message}`);
      const partial = err.funnel || createFunnel(category);
      partial.stage("error", null, 0, [], err.message);
      funnel.absorb(partial);
      errors.push({ category, message: err.message });
    }
  }

  // If every category failed, surface the first error instead of returning empty results silently
  if (errors.length > 0 && allLeads.length === 0) {
    funnel.printSummary("Scan funnel — FAILED");
    throw new Error(errors[0].message);
  }

  const result = scoreProducts(allLeads);
  if (errors.length > 0) {
    result.partialErrors = errors;
  }
  return attachMeta(result, { funnel, approvalRequired });
}

// Asks Claude which categories are worth scanning today (zero Keepa cost — see
// pickTrendingCategories in ai.js), then runs the normal multi-category scan against
// exactly those picks. Returns the picks (with reasoning) alongside the scan result so
// the caller can show the user *why* these categories were chosen.
async function scanTrendingCategories(options = {}, { count = 4 } = {}) {
  const picks = await pickTrendingCategories({ count });
  if (!picks.length) throw new Error("AI category picker returned no valid picks");

  const categories = picks.map((p) => p.category);
  const leads = await scanMultipleCategories(categories, options);

  return { picks, categories, leads };
}

// Scan a pre-loaded supplier product list (output of supplier.matchSupplierToAmazon)
async function scanSupplierProducts(supplierProducts, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const funnel = createFunnel("supplier");
  const matched = getMatched(supplierProducts);
  const matchedSet = new Set(matched);
  funnel.stage("supplier:matched", supplierProducts.length, matched.length,
    supplierProducts.filter((p) => !matchedSet.has(p)).map((p) => ({
      asin: p.asin || p.sku || p.name,
      reason: "no Amazon ASIN match (UPC/title lookup)",
    })));

  if (!matched.length) {
    console.log("[Scanner] No matched supplier products to scan");
    return attachFunnel([], funnel);
  }

  console.log(`[Scanner] Scanning ${matched.length} supplier products...`);
  const asins = matched.map((p) => p.asin);
  const products = await fetchDetails(asins, funnel);

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

  const leads = await runPipeline(merged, opts, funnel, { scanType: "supplier" });
  return attachFunnel(leads, funnel);
}

// Final display cut, shared by every scan route: collapse variants (optional), rank by AI
// confidence, keep the top `limit`. Logs both as funnel stages and prints the scan's
// summary table. There is no minimum-confidence threshold — the top-N cut is the only
// AI-score-based drop.
function finalizeScan(leads, { dedupe = true, limit = 20 } = {}) {
  const funnel = leads.funnel || createFunnel("scan");

  // Approval-requestable leads: one per variant family, best sellers first
  const approvalByGroup = new Map();
  for (const l of leads.approvalRequired || []) {
    const key = l.parentAsin || l.asin;
    const cur = approvalByGroup.get(key);
    if (!cur || (l.monthlySold ?? 0) > (cur.monthlySold ?? 0)) approvalByGroup.set(key, l);
  }
  const approvalRequired = [...approvalByGroup.values()]
    .sort((a, b) => (b.monthlySold ?? 0) - (a.monthlySold ?? 0))
    .slice(0, 50);

  let deduped = leads;
  if (dedupe) {
    deduped = dedupeVariants(leads);
    const kept = new Set(deduped);
    const winnerByGroup = new Map(deduped.map((l) => [l.parentAsin || l.asin, l]));
    funnel.stage("dedupe:variants", leads.length, deduped.length,
      leads.filter((l) => !kept.has(l)).map((l) => ({
        asin: l.asin,
        reason: `variant of parent ${l.parentAsin} — kept ${winnerByGroup.get(l.parentAsin)?.asin} (higher AI confidence)`,
      })));
  }

  const ranked = [...deduped].sort(byConfidenceDesc);
  const top = ranked.slice(0, limit);
  funnel.stage(`ai:top-${limit}`, deduped.length, top.length,
    ranked.slice(limit).map((l, i) => ({
      asin: l.asin,
      reason: `ranked #${limit + i + 1} by AI verdict/score (${l.aiAnalysis?.verdict ?? "-"} ${l.aiAnalysis?.score ?? l.aiAnalysis?.confidenceScore ?? "no score"}), below top-${limit} cutoff`,
    })),
    "no minimum AI score — top-N cut only");

  funnel.printSummary();
  if (approvalRequired.length) console.log(`[Scanner] ${approvalRequired.length} approval-requestable lead(s) returned separately`);
  return { deduped, top, approvalRequired };
}

// Quick single-ASIN analysis. `options`, when passed (e.g. the frontend's active scan
// filters), is checked against the same hard gates scanCategory uses — the result is still
// returned so a direct ASIN lookup never comes back empty with no explanation, but it's
// flagged when it wouldn't have survived the current filter set.
async function scanAsin(asin, buyPrice = null, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  console.log(`[Scanner] Scanning ASIN: ${asin}`);
  const [rawProduct] = await getProductDetails([asin], { full: true });
  if (!rawProduct) throw new Error(`ASIN not found (or no Buy Box / BSR): ${asin}`);
  const passesPreFilter = preFilter([rawProduct], opts).length > 0;

  const [product] = await enrichBsr([rawProduct]);
  const [enriched] = await batchCalculateProfit([{ ...product, sourcePrice: buyPrice }]);
  const passesPostFilter = postFilter([enriched], opts).length > 0;

  const [scored] = scoreProducts([enriched]);
  const [withUngating] = await batchCheckUngating([scored]);
  const passesUngating = filterByUngating([withUngating]).length > 0;

  if (passesPreFilter && passesPostFilter && passesUngating) return withUngating;

  const filterFlags = [];
  if (!passesPreFilter || !passesPostFilter) filterFlags.push("Outside your active scan filters (price/ROI/BSR/etc.)");
  if (!passesUngating) filterFlags.push("Gated — requires approval, not sellable today");

  return { ...withUngating, flags: [...(withUngating.flags || []), ...filterFlags] };
}

const VERDICT_RANK = { WIN: 3, MAYBE: 2, PASS: 1 };

// Sort key from the AI verdict: WIN > MAYBE > PASS, then score within a verdict. Leads
// scored before the WIN/MAYBE/PASS scorer (saved scans) fall back to confidenceScore.
function aiRank(lead) {
  const a = lead.aiAnalysis;
  if (!a || a.error) return null;
  if (a.verdict in VERDICT_RANK) return VERDICT_RANK[a.verdict] * 1000 + (a.score ?? 0);
  return a.confidenceScore ?? null;
}

// Leads whose AI pass errored (aiAnalysis.error set, no score) sort to the bottom
// rather than being dropped — a transient Claude API failure on one lead shouldn't
// shrink the shortlist or lose it to a same-family variant that happened to score.
function byConfidenceDesc(a, b) {
  const scoreA = aiRank(a);
  const scoreB = aiRank(b);
  if (scoreA == null && scoreB == null) return 0;
  if (scoreA == null) return 1;
  if (scoreB == null) return -1;
  return scoreB - scoreA;
}

// Ranks leads by Claude's confidenceScore (highest first) and returns the top `limit`.
// Callers wanting the full set for persistence (e.g. Supabase) should keep a reference
// to the pre-rank array; this only slices for display/API-response purposes.
function rankByConfidence(leads, limit = 20) {
  return [...leads].sort(byConfidenceDesc).slice(0, limit);
}

// Collapses color/size/pack variants of the same base product (Keepa's parentAsin,
// already present on every product — see keepa.js) down to a single lead: the
// best-performing variant by the same confidence ranking used for the final top-20 cut.
// A lead with no parentAsin (not part of any Keepa-known variation family) groups with
// nothing else and always survives on its own. Run this BEFORE rankByConfidence so the
// top 20 shows 20 distinct products, not 20 slots partly consumed by sibling variants.
function dedupeVariants(leads) {
  const groups = new Map(); // groupKey -> best lead seen so far in that group
  for (const lead of leads) {
    const key = lead.parentAsin || lead.asin;
    const current = groups.get(key);
    if (!current || byConfidenceDesc(lead, current) < 0) groups.set(key, lead);
  }
  return [...groups.values()];
}

module.exports = {
  scanCategory,
  scanMultipleCategories,
  scanTrendingCategories,
  scanSupplierProducts,
  scanAsin,
  rankByConfidence,
  dedupeVariants,
  finalizeScan,
  preflightTokens,
  DEFAULT_OPTIONS,
};
