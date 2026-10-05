const { batchGetFeesEstimates, hasCredentials } = require("./spapi");
const { estimateFees } = require("./selleramp");

// Fraction of the sale price assumed as buy cost when there's no real supplier cost.
// A lead priced this way is flagged buyCostAssumed — its ROI is a guess, not a number
// anyone can act on (see ai.js: an assumed-cost lead can never be scored a WIN).
const ASSUMED_COST_RATIO = 0.4;

const round2 = (n) => Math.round(n * 100) / 100;

// Profit at the lead's sale price (the Keepa Buy Box price) using Amazon's own fee
// estimate (SP-API Product Fees). Replaces SellerAmp, whose /api/lookup endpoint doesn't
// exist (404 HTML page — every call silently fell back to a guessed fee table).
// Falls back to the standard fee table per ASIN only when Amazon can't estimate it.
async function batchCalculateProfit(products) {
  const priced = products.filter((p) => p.price > 0);
  const fees = hasCredentials() && priced.length
    ? await batchGetFeesEstimates(priced.map((p) => ({ asin: p.asin, price: p.price })))
    : {};

  return products.map((p) => {
    if (!(p.price > 0)) return { ...p, profitData: null };

    const buyCostAssumed = !(p.sourcePrice > 0);
    const buyPrice = buyCostAssumed ? round2(p.price * ASSUMED_COST_RATIO) : p.sourcePrice;
    const amazon = fees[p.asin];
    const f = amazon?.totalFees != null ? amazon : estimateFees(p.price);
    const profit = p.price - buyPrice - f.totalFees;

    return {
      ...p,
      profitData: {
        buyPrice,
        buyCostAssumed,
        amazonPrice: p.price,
        referralFee: round2(f.referralFee ?? 0),
        fbaFee: round2(f.fbaFee ?? 0),
        totalFees: round2(f.totalFees),
        feeSource: amazon?.totalFees != null ? "sp-api" : "estimate",
        profit: round2(profit),
        roi: round2((profit / buyPrice) * 100),
        margin: round2((profit / p.price) * 100),
        hazmat: p.hazmat ?? null, // from Keepa hazardousMaterials — null = unknown
      },
    };
  });
}

// Profit if the sale price drops by `pct` (referral fee scales with price; FBA fee doesn't).
function profitIfPriceDrops(profitData, pct = 0.15) {
  if (!profitData) return null;
  const { amazonPrice, buyPrice, referralFee, totalFees } = profitData;
  const newPrice = amazonPrice * (1 - pct);
  const newReferral = referralFee * (1 - pct);
  return round2(newPrice - buyPrice - (totalFees - referralFee + newReferral));
}

module.exports = { batchCalculateProfit, profitIfPriceDrops, ASSUMED_COST_RATIO };
