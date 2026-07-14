const axios = require("axios");

const KEEPA_KEY = process.env.KEEPA_KEY;

const CATEGORY_IDS = {
  beauty: 11055981,
  kitchen: 284507,
  health: 3760901,
  toys: 165793011,
  pets: 2619533011,
  sports: 3375251,
  office: 1064954,
  baby: 165796011,
  tools: 468642,
  electronics: 172282,
};

function handleKeepaError(err) {
  if (err.response?.status === 429 || err.response?.data?.error?.includes("429")) {
    throw new Error("Keepa API out of tokens — tokens refill at 1/min. Wait a few minutes and retry.");
  }
  throw err;
}

// Search for products in a category
async function searchCategory(categoryId, minPrice, maxPrice, page = 0) {
  const selection = {
    categories: [CATEGORY_IDS[categoryId]],
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

    // Subcategory
    const subcategory = p.categoryTree?.[p.categoryTree.length - 1]?.name || "General";

    return {
      asin: p.asin,
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

module.exports = { searchCategory, getProductDetails, CATEGORY_IDS };
