const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

function buildLeadContext(lead) {
  const pd = lead.profitData || {};
  return `
PRODUCT: ${lead.title || "Unknown"}
ASIN: ${lead.asin}
Category: ${lead.category || "Unknown"}
Amazon URL: ${lead.url || `https://www.amazon.com/dp/${lead.asin}`}

FINANCIALS
  Sale price:    $${lead.price}
  Buy price:     $${pd.buyPrice ?? "unknown"}
  Profit/unit:   $${pd.profit}
  ROI:           ${pd.roi}%
  Margin:        ${pd.margin}%
  FBA fee:       $${pd.fbaFee}
  Referral fee:  $${pd.referralFee}
  Total fees:    $${pd.totalFees}

DEMAND SIGNALS
  BSR:           ${lead.bsr?.toLocaleString() ?? "unknown"} (${lead.bsrTrend ?? "unknown"} trend)
  BSR 30d avg:   ${lead.bsr30?.toLocaleString() ?? "unknown"}
  BSR 90d avg:   ${lead.bsr90?.toLocaleString() ?? "unknown"}
  Rating:        ${lead.rating ?? "unknown"} ★
  Reviews:       ${lead.reviews?.toLocaleString() ?? "unknown"}

PRICE HISTORY
  Stable:        ${lead.priceStable === true ? "Yes" : lead.priceStable === false ? "No — volatile" : "Unknown"}
  90d min:       $${lead.priceMin90 ?? "unknown"}
  90d max:       $${lead.priceMax90 ?? "unknown"}

COMPETITION
  Seller count:  ${lead.sellerCount ?? "unknown"}
  New sellers (30d): ${lead.newSellers30d ?? 0}
  Restricted:    ${pd.restricted ? "YES" : "No"}
  Hazmat:        ${pd.hazmat ? "YES" : "No"}
  Oversized:     ${pd.oversized ? "YES" : "No"}

SCORE
  Grade: ${lead.grade}  Score: ${lead.score}/100
  Strengths: ${lead.reasons?.join(", ") || "none"}
  Flags: ${lead.flags?.join(", ") || "none"}
`.trim();
}

// Analyze a single lead and return a structured AI verdict
async function analyzeLead(lead) {
  const context = buildLeadContext(lead);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: `You are an expert Amazon FBA sourcing analyst. You evaluate wholesale and retail arbitrage leads for profitability, demand, and risk. Be direct, specific, and actionable. Use concrete numbers from the data provided. Never invent numbers not given to you.`,
    messages: [
      {
        role: "user",
        content: `Analyze this Amazon sourcing lead and give me your verdict:\n\n${context}\n\nRespond in this exact JSON format:
{
  "verdict": "Strong Buy | Buy | Hold | Pass",
  "confidence": "High | Medium | Low",
  "summary": "2-sentence plain-English verdict",
  "strengths": ["specific strength 1", "specific strength 2"],
  "risks": ["specific risk 1", "specific risk 2"],
  "recommendation": "One concrete action sentence — what should the sourcer actually do?",
  "estimatedMonthlySales": "rough estimate or null if insufficient data",
  "watchOut": "The single biggest thing to verify before buying"
}`,
      },
    ],
  });

  const raw = message.content[0].text.trim();

  // Strip markdown code fences if Claude wrapped the JSON
  const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(json);
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
    .map(s => ({ ...s, tier: tierFor(s.domain) }))
    .sort((a, b) => {
      // Sort: verified first within price rank; unverified last
      if (a.estimatedPrice && b.estimatedPrice) return a.estimatedPrice - b.estimatedPrice;
      if (a.estimatedPrice) return -1;
      if (b.estimatedPrice) return 1;
      return 0;
    });
}

module.exports = { analyzeLead, analyzeLeads, quickTake, findSupplierSources };
