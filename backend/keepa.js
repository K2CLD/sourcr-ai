const axios = require("axios");

const KEEPA_KEY = process.env.KEEPA_KEY;

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
  const res = await axios.get("https://api.keepa.com/category", {
    params: { key: KEEPA_KEY, domain: 1, category: ids.join(",") },
  }).catch(handleKeepaError);
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

// Search for products in a category
async function searchCategory(categoryId, minPrice, maxPrice, page = 0) {
  const selection = {
    categories_include: [CATEGORY_IDS[categoryId]],
    priceTypes: [0],
    minPrice: minPrice * 100,
    maxPrice: maxPrice * 100,
    minRating: 40,
    sortType: 0,
    perPage: 50,
    page,
  };

  const res = await axios.get("https://api.keepa.com/query", {
    params: {
      key: KEEPA_KEY,
      domain: 1,
      selection: JSON.stringify(selection),
    },
  }).catch(handleKeepaError);

  return res.data.asinList || [];
}

// Get detailed product data for a list of ASINs
async function getProductDetails(asins) {
  const res = await axios.get("https://api.keepa.com/product", {
    params: {
      key: KEEPA_KEY,
      domain: 1,
      asin: asins.join(","),
      stats: 90,
      history: 1,
    },
  }).catch(handleKeepaError);

  return (res.data.products || []).map((p) => {
    // current[28] = buy box price (what customers actually pay for FBA/third-party products)
    // current[0]  = Amazon's own first-party price (-1 for almost all third-party FBA items)
    // current[1]  = marketplace new price (fallback)
    const price =
      p.stats?.current?.[28] > 0 ? p.stats.current[28] / 100 :
      p.stats?.current?.[0]  > 0 ? p.stats.current[0]  / 100 :
      p.stats?.current?.[1]  > 0 ? p.stats.current[1]  / 100 : null;

    // Fallback BSR — scanner.js overrides this with SP-API Catalog Items' salesRanks
    // when SP-API credentials are configured (see scanner.js enrichBsr)
    const bsr = p.stats?.current?.[3] > 0 ? p.stats.current[3] : null;

    // Rating and review counts are often absent from current[] — try current, avg30, avg90 in order
    const ratingRaw = [p.stats?.current?.[16], p.stats?.avg30?.[16], p.stats?.avg90?.[16]]
      .find(v => v != null && v > 0);
    const rating = ratingRaw != null ? ratingRaw / 10 : null;

    const reviews = [p.stats?.current?.[17], p.stats?.avg30?.[17], p.stats?.avg90?.[17]]
      .find(v => v != null && v > 0) ?? null;

    // BSR trend — compare 30 day avg vs 90 day avg
    const bsr30 = p.stats?.avg30?.[3];
    const bsr90 = p.stats?.avg90?.[3];
    const bsrTrend = bsr30 && bsr90 ? (bsr30 < bsr90 ? "rising" : "falling") : "unknown";

    // Price stability — use buy box price history (index 28) then fall back to amazon (index 0)
    const priceMin90 =
      p.stats?.min90?.[28] > 0 ? p.stats.min90[28] / 100 :
      p.stats?.min90?.[0]  > 0 ? p.stats.min90[0]  / 100 : null;
    const priceMax90 =
      p.stats?.max90?.[28] > 0 ? p.stats.max90[28] / 100 :
      p.stats?.max90?.[0]  > 0 ? p.stats.max90[0]  / 100 : null;
    const priceStable = priceMin90 && priceMax90 ? ((priceMax90 - priceMin90) / priceMax90) < 0.2 : null;

    // New sellers in last 30 days
    const newSellers30d = p.stats?.newOfferCount30 || 0;

    // Total offers competing for the buy box (COUNT_NEW) — proxy for seller count;
    // Keepa's live `offers` endpoint would give an exact FBA-only count but costs extra tokens
    const sellerCount = p.stats?.current?.[11] > 0 ? p.stats.current[11] : null;

    // Same field averaged over 30d/90d — used to detect a sustained single-seller listing
    // (private-label signal; see scanner.js isLikelyPrivateLabel)
    const sellerCount30 = p.stats?.avg30?.[11] > 0 ? p.stats.avg30[11] : null;
    const sellerCount90 = p.stats?.avg90?.[11] > 0 ? p.stats.avg90[11] : null;

    // current[0] is Amazon's own first-party price, -1 when Amazon has no offer on the listing
    const amazonSells = (p.stats?.current?.[0] ?? -1) > 0;

    // Keepa-estimated units sold in the last 30 days — not returned for every ASIN
    const monthlySold = p.monthlySold ?? null;

    // Subcategory
    const subcategory = p.categoryTree?.[p.categoryTree.length - 1]?.name || "General";

    return {
      asin: p.asin,
      // Keepa groups color/size/pack variants of the same listing under a shared
      // parentAsin (already present on every product response, no extra cost) —
      // used in scanner.js to dedupe near-identical variants before ranking.
      parentAsin: p.parentAsin || null,
      title: p.title,
      brand: p.brand,
      price,
      bsr,
      rating,
      reviews,
      bsrTrend,
      bsr30,
      bsr90,
      priceStable,
      priceMin90,
      priceMax90,
      newSellers30d,
      sellerCount,
      sellerCount30,
      sellerCount90,
      amazonSells,
      monthlySold,
      subcategory,
      url: `https://www.amazon.com/dp/${p.asin}`,
      imageUrl: (() => {
        // p.imagesCSV is always empty; real image data is in p.images[].m (medium) or .l (large)
        const file = p.images?.[0]?.m || p.images?.[0]?.l;
        if (!file) return null;
        // Insert ._AC_SL75_ before the .jpg extension for a 75px thumbnail
        return `https://images-na.ssl-images-amazon.com/images/I/${file.replace(/\.jpg$/i, '._AC_SL75_.jpg')}`;
      })(),
    };
  // Only require price and BSR — rating/reviews are frequently absent from Keepa stats
  // and get filtered downstream in scanner.js preFilter if opts require them
  }).filter((p) => p.price && p.bsr);
}

module.exports = { searchCategory, getProductDetails, getCategoryTree, CATEGORY_IDS };
