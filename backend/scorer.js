// Weighted scoring system for Amazon sourcing leads
// Each product gets a score 0–100 and a letter grade A–D

const WEIGHTS = {
  roi: 28,
  bsr: 22,
  bsrTrend: 10,
  priceStability: 10,
  rating: 10,
  reviews: 10,
  absoluteProfit: 5,
  newSellers: 5,
};

function scoreProduct(product) {
  let score = 0;
  const reasons = [];
  const flags = [];

  const roi = parseFloat(product.profitData?.roi ?? 0);
  const profit = parseFloat(product.profitData?.profit ?? 0);
  const bsr = product.bsr ?? Infinity;
  const rating = product.rating ?? 0;
  const reviews = product.reviews ?? 0;

  // ROI (0–28 pts)
  if (roi >= 50) { score += 28; reasons.push("Excellent ROI (50%+)"); }
  else if (roi >= 35) { score += 20; reasons.push("Strong ROI (35%+)"); }
  else if (roi >= 20) { score += 12; reasons.push("Decent ROI (20%+)"); }
  else if (roi >= 10) { score += 5; }
  else { flags.push("Low ROI (<10%)"); }

  // BSR (0–22 pts) — lower rank = more sales
  if (bsr <= 1000) { score += 22; reasons.push("Top 1K BSR"); }
  else if (bsr <= 5000) { score += 18; reasons.push("Top 5K BSR"); }
  else if (bsr <= 15000) { score += 14; reasons.push("Top 15K BSR"); }
  else if (bsr <= 30000) { score += 9; }
  else if (bsr <= 50000) { score += 4; }
  else { flags.push("Weak BSR (>50K)"); }

  // BSR trend (0–10 pts)
  if (product.bsrTrend === "rising") { score += 10; reasons.push("Rising sales trend"); }
  else if (product.bsrTrend === "falling") { score += 2; flags.push("Falling sales trend"); }
  else { score += 5; } // unknown — neutral

  // Price stability (0–10 pts)
  if (product.priceStable === true) { score += 10; reasons.push("Stable price history"); }
  else if (product.priceStable === false) { flags.push("Volatile price (<20% spread)"); }
  else { score += 5; } // unknown — neutral

  // Rating (0–10 pts)
  if (rating >= 4.5) { score += 10; reasons.push("Excellent rating (4.5+)"); }
  else if (rating >= 4.0) { score += 7; reasons.push("Good rating (4.0+)"); }
  else if (rating >= 3.5) { score += 3; }
  else { flags.push("Low rating (<3.5)"); }

  // Review count (0–10 pts) — validates demand
  if (reviews >= 1000) { score += 10; reasons.push("Strong social proof (1K+ reviews)"); }
  else if (reviews >= 500) { score += 8; reasons.push("Good review count (500+)"); }
  else if (reviews >= 100) { score += 5; }
  else if (reviews >= 25) { score += 2; }
  else { flags.push("Few reviews — unproven demand"); }

  // Absolute profit (0–5 pts)
  if (profit >= 15) { score += 5; reasons.push("High profit per unit ($15+)"); }
  else if (profit >= 8) { score += 4; reasons.push("Good profit per unit ($8+)"); }
  else if (profit >= 4) { score += 2; }
  else { flags.push("Low profit per unit (<$4)"); }

  // Competition penalty (up to –8 pts)
  if (product.newSellers30d > 10) { score -= 8; flags.push("Heavy new seller competition"); }
  else if (product.newSellers30d > 5) { score -= 4; flags.push("Moderate new seller competition"); }
  else { score += 5; reasons.push("Low new seller pressure"); }

  // Hard disqualifiers — don't just penalize, flag clearly
  if (product.profitData?.restricted) { score -= 25; flags.push("RESTRICTED — cannot sell"); }
  if (product.profitData?.hazmat) { score -= 15; flags.push("Hazmat — special handling required"); }
  if (product.profitData?.oversized) { score -= 5; flags.push("Oversized — higher FBA fees"); }

  const clamped = Math.max(0, Math.min(100, score));
  const grade = clamped >= 75 ? "A" : clamped >= 55 ? "B" : clamped >= 35 ? "C" : "D";

  return { ...product, score: clamped, grade, reasons, flags };
}

function scoreProducts(products) {
  return products.map(scoreProduct).sort((a, b) => b.score - a.score);
}

function filterByGrade(products, minGrade = "B") {
  const rank = { A: 4, B: 3, C: 2, D: 1 };
  const min = rank[minGrade] ?? 3;
  return products.filter((p) => (rank[p.grade] ?? 0) >= min);
}

// Return a human-readable summary for a scored product
function summarize(product) {
  const p = product.profitData || {};
  return [
    `${product.asin} — Grade ${product.grade} (${product.score}/100)`,
    `  Price: $${product.price} | Profit: $${p.profit} | ROI: ${p.roi}%`,
    `  BSR: ${product.bsr?.toLocaleString()} (${product.bsrTrend}) | Rating: ${product.rating} (${product.reviews} reviews)`,
    `  Pros: ${product.reasons.join(", ") || "none"}`,
    `  Flags: ${product.flags.join(", ") || "none"}`,
  ].join("\n");
}

module.exports = { scoreProduct, scoreProducts, filterByGrade, summarize };
