const axios = require("axios");

const SELLERAMP_KEY = process.env.SELLERAMP_KEY;

// Calculate FBA profit for a product
async function calculateProfit(asin, buyPrice) {
  try {
    const res = await axios.get("https://sas.selleramp.com/api/lookup", {
      params: {
        api_key: SELLERAMP_KEY,
        asin,
        buy_price: buyPrice,
      },
      timeout: 8000,
    });

    const d = res.data;

    return {
      asin,
      buyPrice,
      amazonPrice: d.amazon_price,
      fbaFee: d.fba_fee,
      referralFee: d.referral_fee,
      totalFees: d.total_fees,
      profit: d.profit,
      roi: d.roi,
      margin: d.margin,
      approved: d.approved_to_sell,
      restricted: d.restricted,
      hazmat: d.hazmat,
      oversized: d.oversized,
      estimatedSales: d.estimated_sales,
      source: "selleramp",
    };
  } catch (err) {
    return fallbackCalculate(asin, buyPrice);
  }
}

// Fallback calculation using standard FBA fee tiers when SellerAmp is unavailable
function fallbackCalculate(asin, buyPrice) {
  const amazonPrice = buyPrice * 2.5;
  const referralFee = amazonPrice * 0.15;

  let fbaFee;
  if (amazonPrice < 10) fbaFee = 2.92;
  else if (amazonPrice < 20) fbaFee = 3.22;
  else if (amazonPrice < 40) fbaFee = 4.56;
  else if (amazonPrice < 70) fbaFee = 5.42;
  else fbaFee = 6.13;

  const totalFees = referralFee + fbaFee;
  const profit = amazonPrice - buyPrice - totalFees;
  const roi = ((profit / buyPrice) * 100).toFixed(1);
  const margin = ((profit / amazonPrice) * 100).toFixed(1);

  return {
    asin,
    buyPrice,
    amazonPrice: +amazonPrice.toFixed(2),
    fbaFee: +fbaFee.toFixed(2),
    referralFee: +referralFee.toFixed(2),
    totalFees: +totalFees.toFixed(2),
    profit: +profit.toFixed(2),
    roi: +roi,
    margin: +margin,
    approved: null,
    restricted: false,
    hazmat: false,
    oversized: false,
    estimatedSales: null,
    source: "fallback",
  };
}

// Check gating/restriction status for a product
async function checkApproval(asin) {
  try {
    const res = await axios.get("https://sas.selleramp.com/api/restrictions", {
      params: { api_key: SELLERAMP_KEY, asin },
      timeout: 8000,
    });

    return {
      asin,
      approved: res.data.approved_to_sell,
      restricted: res.data.restricted,
      requiresApproval: res.data.requires_approval,
      gated: res.data.gated,
      notes: res.data.notes || "",
    };
  } catch {
    return { asin, approved: null, restricted: null, requiresApproval: null, gated: null, notes: "Could not verify" };
  }
}

// Batch calculate profit for a list of products using buy price or 40% of sale price as fallback
async function batchCalculate(products) {
  const results = await Promise.allSettled(
    products.map((p) => calculateProfit(p.asin, p.sourcePrice || p.price * 0.4))
  );

  return results.map((r, i) => ({
    ...products[i],
    profitData:
      r.status === "fulfilled"
        ? r.value
        : fallbackCalculate(products[i].asin, products[i].sourcePrice || products[i].price * 0.4),
  }));
}

module.exports = { calculateProfit, checkApproval, batchCalculate, fallbackCalculate };
