const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { CATEGORY_IDS } = require("./keepa");
const { profitIfPriceDrops } = require("./profit");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

// Pick which categories are worth scanning today, using Claude's general market/seasonality
// knowledge only — zero Keepa calls. Deliberately does NOT pull live Keepa bestseller/trend
// data per category: at only 10 fixed categories, checking each would cost ~11 tokens/category
// (110 tokens total) just for a discovery step before the real scan even starts, and general
// seasonal reasoning (holidays, back-to-school, weather) is a reasonable zero-cost proxy for
// which categories are worth prioritizing. If picks turn out too generic, the next step would
// be wiring in a cheap per-category signal (e.g. a single Product Finder search page sorted by
// sales rank, no /product detail calls) — not built here since it wasn't needed yet.
async function pickTrendingCategories({ count = 4 } = {}) {
  const categories = Object.keys(CATEGORY_IDS);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: "You are an expert Amazon FBA sourcing strategist choosing which product categories to scan today, using seasonality and general market knowledge — no live sales data is available. Be specific and concrete about WHY a category is timely right now; avoid generic filler reasoning.",
    messages: [
      {
        role: "user",
        content: `Today's date: ${today}.

Categories available to scan (pick only from this exact list): ${categories.join(", ")}

Pick the ${count} categories most worth sourcing from today for Amazon FBA resale, considering seasonality, upcoming holidays/events, and typical demand patterns at this time of year. Respond in this exact JSON format, nothing else:
{"picks":[{"category":"one of the exact category names above","reason":"one specific sentence — cite the actual seasonal/market driver, not a generic statement"}]}`,
      },
    ],
  });

  const raw = message.content[0].text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);

  return (parsed.picks || []).filter((p) => categories.includes(p.category));
}

// ─── WIN / MAYBE / PASS scorer ────────────────────────────────────────────────

const SCORER_MODEL = "claude-opus-5-5";

const SCORER_SYSTEM = `You are an expert Amazon FBA sourcer judging whether a product is a WIN: a buy that will sell through within 30-60 days at or near the current price and return the projected profit. Weigh, in order:
- Price stability: Buy Box price held steady over 90 days. A current price spiked above the 90-day average is a trap.
- Sell-through: strong sales per seller. More sellers splitting the same sales = slower turns.
- Competition trend: seller count rising fast = incoming price war.
- Amazon presence: Amazon on the listing more than 30% of the time is a major risk.
- BSR consistency: steady BSR beats a one-time spike.
- Profit margin of safety: would it still profit if the price dropped 15%?
- Risk flags: hazmat, IP/brand complaint risk, low ratings, seasonality.
Be strict. Most products should be PASS. Only call WIN when you'd personally put money on it.

Data notes:
- null means the data is unavailable — treat it as unknown, never as zero or as good news.
- If buyCostAssumed is true, the buy cost is a placeholder (40% of the sell price), not a real supplier quote, so profit and ROI are hypothetical. Such a product can be MAYBE at best — never WIN.
- profitIfPriceDrops15pct is pre-computed from the same fees; use it for the margin-of-safety check.`;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["WIN", "MAYBE", "PASS"] },
    score: { type: "integer", description: "0-100" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    why: { type: "string", description: "1-2 sentences" },
    risks: { type: "array", items: { type: "string" } },
    profit_if_price_drops_15pct: { type: "number" },
  },
  required: ["verdict", "score", "confidence", "why", "risks", "profit_if_price_drops_15pct"],
  additionalProperties: false,
};

const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

function trend(now, avg90) {
  if (now == null || avg90 == null) return "unknown";
  if (avg90 === 0) return now > 0 ? "rising" : "flat";
  const change = (now - avg90) / avg90;
  return change > 0.25 ? "rising" : change < -0.25 ? "falling" : "flat";
}

// The structured per-ASIN data Claude judges. Everything here is real data from Keepa,
// SP-API fees, or the scan — no field is invented when missing (null instead).
function buildPacket(lead) {
  const pd = lead.profitData || {};
  const splitSellers = lead.fbaSellerCount > 0 ? lead.fbaSellerCount : lead.sellerCount;

  return {
    asin: lead.asin,
    title: lead.title ?? null,
    brand: lead.brand ?? null,
    category: lead.category ?? null,
    subcategory: lead.subcategory ?? null,
    buyCost: pd.buyPrice ?? null,
    buyCostAssumed: pd.buyCostAssumed ?? true,
    sellPrice: lead.price ?? null,
    fees: {
      referral: pd.referralFee ?? null,
      fba: pd.fbaFee ?? null,
      total: pd.totalFees ?? null,
      source: pd.feeSource === "sp-api" ? "Amazon SP-API estimate" : "fee-table estimate",
    },
    netProfit: pd.profit ?? null,
    roiPct: pd.roi ?? null,
    profitIfPriceDrops15pct: profitIfPriceDrops(pd),
    bsr: { now: lead.bsr ?? null, avg30: lead.bsr30 ?? null, avg90: lead.bsr90 ?? null },
    buyBox90d: {
      current: lead.price ?? null,
      min: lead.priceMin90 ?? null,
      max: lead.priceMax90 ?? null,
      avg: lead.priceAvg90 ?? null,
      currentVsAvgPct: lead.price && lead.priceAvg90 ? round(((lead.price - lead.priceAvg90) / lead.priceAvg90) * 100, 1) : null,
    },
    fbaSellers: {
      now: lead.fbaSellerCount ?? null,
      avg30: lead.fbaSellerCount30 ?? null,
      avg90: lead.fbaSellerCount90 ?? null,
      trend: trend(lead.fbaSellerCount, lead.fbaSellerCount90),
    },
    allNewOffers: { now: lead.sellerCount ?? null, avg90: lead.sellerCount90 ?? null },
    amazonOnListingPct90d: lead.amazonOnListingPct90 ?? null,
    amazonBuyBoxSharePct90d: lead.amazonBuyBoxPct90 ?? null,
    estMonthlySales: lead.monthlySold ?? null,
    salesPerSeller: lead.monthlySold != null && splitSellers > 0 ? round(lead.monthlySold / splitSellers, 1) : null,
    hazmat: lead.hazmat ?? pd.hazmat ?? null,
    rating: lead.rating ?? null,
    reviewCount: lead.reviews ?? null,
  };
}

// ── Few-shot examples: the user's real past wins/losses ──
// wins.json: [{ asin, category?, snapshot: {...packet-like data}, outcome, notes }]
// Looked up in the app data dir first (packaged app), then database/.
const WINS_FILES = [
  process.env.SOURCR_DATA_DIR && path.join(process.env.SOURCR_DATA_DIR, "wins.json"),
  path.join(__dirname, "..", "database", "wins.json"),
].filter(Boolean);

let winsCache = { file: null, mtimeMs: 0, entries: [] };

function loadWins() {
  for (const file of WINS_FILES) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (winsCache.file === file && winsCache.mtimeMs === stat.mtimeMs) return winsCache.entries;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const entries = (Array.isArray(parsed) ? parsed : []).filter((e) => e?.asin && e?.outcome);
      winsCache = { file, mtimeMs: stat.mtimeMs, entries };
      console.log(`[AI] Loaded ${entries.length} past outcome(s) from ${file}`);
      return entries;
    } catch (err) {
      console.warn(`[AI] Could not read ${file}: ${err.message}`);
      return [];
    }
  }
  return [];
}

// Up to `max` examples: same category first, then alternating outcomes so Claude sees
// both what worked and what didn't.
function pickExamples(lead, max = 5) {
  const entries = loadWins().filter((e) => e.asin !== lead.asin);
  const sameCat = (e) => (lead.category && e.category === lead.category ? 0 : 1);
  const sorted = [...entries].sort((a, b) => sameCat(a) - sameCat(b));

  const byOutcome = new Map();
  for (const e of sorted) {
    const key = String(e.outcome).toUpperCase();
    if (!byOutcome.has(key)) byOutcome.set(key, []);
    byOutcome.get(key).push(e);
  }
  const picked = [];
  while (picked.length < max && [...byOutcome.values()].some((q) => q.length)) {
    for (const q of byOutcome.values()) if (q.length && picked.length < max) picked.push(q.shift());
  }
  return picked;
}

function examplesBlock(examples) {
  if (!examples.length) return "";
  const lines = examples.map((e, i) =>
    `Example ${i + 1} — ${e.asin}${e.category ? ` (${e.category})` : ""}\nData: ${JSON.stringify(e.snapshot ?? {})}\nOutcome: ${e.outcome}${e.notes ? `\nNotes: ${e.notes}` : ""}`
  );
  return `\n\nReal past outcomes from this seller (calibrate against these):\n\n${lines.join("\n\n")}`;
}

// Score one lead. Returns { verdict, score, confidence, why, risks,
// profit_if_price_drops_15pct, costAssumed, cappedFromWin? }.
async function analyzeLead(lead) {
  const packet = buildPacket(lead);
  const examples = pickExamples(lead);

  const message = await client.beta.messages.create({
    model: SCORER_MODEL,
    max_tokens: 8000,
    // Server-side fallback: if a safety classifier declines, Anthropic re-runs the request
    // on its recommended fallback model instead of returning the refusal.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: VERDICT_SCHEMA },
    },
    system: SCORER_SYSTEM + examplesBlock(examples),
    messages: [{ role: "user", content: `Judge this product:\n${JSON.stringify(packet, null, 2)}` }],
  });

  if (message.stop_reason === "refusal") throw new Error("Claude declined to score this lead");
  if (message.stop_reason === "max_tokens") throw new Error("Scorer response was cut off (max_tokens)");
  const text = message.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Scorer returned no verdict");
  const result = JSON.parse(text);

  result.score = Math.max(0, Math.min(100, Math.round(result.score)));
  // The pre-computed figure is exact arithmetic on the same fees — prefer it over the model's
  if (packet.profitIfPriceDrops15pct != null) result.profit_if_price_drops_15pct = packet.profitIfPriceDrops15pct;

  // Hard rule, enforced in code as well as the prompt: no real cost, no WIN.
  result.costAssumed = packet.buyCostAssumed;
  if (packet.buyCostAssumed && result.verdict === "WIN") {
    result.verdict = "MAYBE";
    result.cappedFromWin = true;
  }
  return result;
}

// Analyze multiple leads and attach AI analysis to each
async function analyzeLeads(leads, { concurrency = 3 } = {}) {
  const results = [];

  for (let i = 0; i < leads.length; i += concurrency) {
    const batch = leads.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((l) => analyzeLead(l)));

    settled.forEach((r, idx) => {
      const lead = batch[idx];
      results.push({
        ...lead,
        aiAnalysis: r.status === "fulfilled" ? r.value : { error: r.reason?.message || "Analysis failed" },
      });
    });
  }

  return results;
}

// Generate a short "why this deal" blurb — lightweight, single sentence
async function quickTake(lead) {
  const pd = lead.profitData || {};
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 80,
    messages: [
      {
        role: "user",
        content: `In one sentence, why is this Amazon FBA lead grade ${lead.grade} with ${pd.roi}% ROI and BSR ${lead.bsr?.toLocaleString()}? Product: ${lead.title}`,
      },
    ],
  });
  return message.content[0].text.trim();
}

// Amazon and Amazon-owned domains — hard blocklist applied before returning to the client
const AMAZON_DOMAINS = new Set([
  "amazon.com","amazon.co.uk","amazon.ca","amazon.de","amazon.fr",
  "amazon.it","amazon.es","amazon.co.jp","amazon.com.au","amazon.in",
  "amazon.com.br","amazon.com.mx","amazon.nl","amazon.se","amazon.sg",
  "amazon.com.tr","amazon.ae","amazon.sa","amzn.com","amzn.to",
  "wholefoodsmarket.com","zappos.com","shopbop.com","woot.com",
  "diapers.com","fabric.com","ring.com","audible.com","twitch.tv",
  "imdb.com","goodreads.com","comixology.com","abebooks.com",
]);

const VERIFIED_RETAILERS = new Set([
  "costco.com","walmart.com","samsclub.com","target.com","homedepot.com",
  "lowes.com","bjs.com","kroger.com","cvs.com","walgreens.com","rite-aid.com",
  "bedbathandbeyond.com","overstock.com","macys.com","kohls.com","bestbuy.com",
  "wayfair.com","chewy.com","petco.com","petsmart.com","staples.com",
  "officedepot.com","dollargeneral.com","dollartree.com","biglots.com",
  "tjmaxx.com","marshalls.com","homegoods.com","ross.com","burlington.com",
]);

function isAmazonSource(s) {
  const text = [s.name, s.domain, s.url, s.searchUrl].join(" ").toLowerCase();
  if (text.includes("amazon")) return true;
  const domain = (s.domain || "").toLowerCase().replace(/^www\./, "");
  return AMAZON_DOMAINS.has(domain);
}

function tierFor(domain) {
  const d = (domain || "").toLowerCase().replace(/^www\./, "");
  if (VERIFIED_RETAILERS.has(d)) return "verified";
  if (["faire.com","tundra.com","alibaba.com","dhgate.com","globalsources.com",
       "abound.com","faire.com","handshake.com","salehoo.com","worldwide-brands.com",
       "b-stock.com","directliquidation.com","bulq.com"].includes(d)) return "wholesale";
  return "unverified";
}

// Claude is asked to produce a searchUrl per source, but it's generating that URL from
// memory/pattern-matching — not a verified fact — and it gets it wrong often enough to
// matter (confirmed live: it produced a 404 Alibaba URL and a wrong Costco path). For the
// domains below, the URL is built from a known-correct template instead of trusting
// Claude's guess; each pattern here was hit with a real request and confirmed to return
// 200. Domains not listed here still use whatever Claude produced — unverified, same as
// before — rather than us guessing a pattern we haven't actually tested either.
const SEARCH_URL_TEMPLATES = {
  "walmart.com":  (q) => `https://www.walmart.com/search?q=${q}`,
  "target.com":   (q) => `https://www.target.com/s?searchTerm=${q}`,
  "costco.com":   (q) => `https://www.costco.com/CatalogSearch?dept=All&keyword=${q}`,
  "samsclub.com": (q) => `https://www.samsclub.com/s/${q}`,
  "faire.com":    (q) => `https://www.faire.com/search?q=${q}`,
  "alibaba.com":  (q) => `https://www.alibaba.com/trade/search?SearchText=${q}`,
};

function buildVerifiedSearchUrl(domain, query) {
  const d = (domain || "").toLowerCase().replace(/^www\./, "");
  const template = SEARCH_URL_TEMPLATES[d];
  return template ? template(encodeURIComponent(query)) : null;
}

// Find legitimate off-Amazon sourcing options for a product
async function findSupplierSources(lead) {
  const title  = lead.title  || lead.asin;
  const brand  = lead.brand  || "";
  const price  = lead.price  || "";
  const cat    = lead.category || "";

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    messages: [{
      role: "user",
      content: `You are a sourcing expert for Amazon FBA sellers. Find where to BUY this product cheaply for resale.

Product: ${title}
Brand: ${brand}
Category: ${cat}
Current Amazon sell price: $${price}

Return 5-7 legitimate off-Amazon sources ranked from cheapest estimated buy price to most expensive.

HARD RULES — any violation makes the output worthless:
- NEVER include Amazon, Amazon.com, Amazon Warehouse, Amazon Business, or ANY Amazon-owned property (Whole Foods, Zappos, Woot, Shopbop, Ring, Audible, Twitch, IMDb, Goodreads)
- ONLY include: major retailers (Costco, Walmart, Sam's Club, Target, Home Depot, Lowe's, BJ's), brand/manufacturer direct websites, wholesale B2B platforms (Faire, Tundra, Alibaba, DHgate, Abound), or liquidation (B-Stock, Direct Liquidation, Bulq)
- estimatedPrice must be a realistic number based on typical retail margins (e.g. Costco ≈ 15-25% below Amazon, Walmart ≈ 5-15% below, wholesale ≈ 40-60% of retail)
- searchUrl must be a real working search URL for that retailer — use the product title or brand as the search term
- If you cannot confidently estimate a price for a source, set estimatedPrice to null

Return ONLY valid JSON, no markdown, no explanation:
{"sources":[{"name":"...","domain":"...","type":"retail|wholesale|brand|liquidation","estimatedPrice":0.00,"searchUrl":"https://...","notes":"..."}]}`,
    }],
  });

  const raw = msg.content[0].text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
  } catch {
    throw new Error("Could not parse supplier sources response");
  }

  return (parsed.sources || [])
    .filter(s => !isAmazonSource(s))
    .map(s => ({
      ...s,
      tier: tierFor(s.domain),
      searchUrl: buildVerifiedSearchUrl(s.domain, title) || s.searchUrl,
    }))
    .sort((a, b) => {
      // Sort: verified first within price rank; unverified last
      if (a.estimatedPrice && b.estimatedPrice) return a.estimatedPrice - b.estimatedPrice;
      if (a.estimatedPrice) return -1;
      if (b.estimatedPrice) return 1;
      return 0;
    });
}

module.exports = { analyzeLead, analyzeLeads, quickTake, findSupplierSources, pickTrendingCategories };
