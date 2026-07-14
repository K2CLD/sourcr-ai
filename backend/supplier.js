const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Parse a supplier CSV price list into a normalized array
// Expected columns (any order, case-insensitive): name/title, cost/price, upc/ean/barcode, sku, qty/quantity
function parseSupplierCSV(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 2) throw new Error("CSV has no data rows");

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));

  const col = (row, ...keys) => {
    for (const k of keys) {
      const idx = headers.indexOf(k);
      if (idx !== -1) return (row[idx] || "").trim().replace(/^"|"$/g, "");
    }
    return "";
  };

  return lines.slice(1).map((line) => {
    // Handle quoted fields containing commas
    const row = line.match(/(".*?"|[^,]+)(?=,|$)/g)?.map((v) => v.replace(/^"|"$/g, "")) || line.split(",");
    const cost = parseFloat(col(row, "cost", "price", "buy price", "wholesale price", "unit cost") || 0);
    return {
      name: col(row, "name", "title", "product", "description", "item"),
      cost,
      upc: col(row, "upc", "ean", "barcode", "gtin"),
      sku: col(row, "sku", "supplier sku", "item number", "model"),
      quantity: parseInt(col(row, "qty", "quantity", "moq") || "1", 10),
      source: path.basename(filePath),
    };
  }).filter((p) => p.cost > 0 && p.name);
}

// Lookup Amazon ASIN by UPC/EAN barcode using Keepa
async function lookupAsinByUpc(upc) {
  try {
    const res = await axios.get("https://api.keepa.com/query", {
      params: { key: process.env.KEEPA_KEY, domain: 1, type: "barcode", id: upc },
      timeout: 8000,
    });
    const asins = res.data.asinList || [];
    return asins[0] || null;
  } catch {
    return null;
  }
}

// Lookup Amazon ASIN by title search using Keepa
async function lookupAsinByTitle(title) {
  try {
    const res = await axios.get("https://api.keepa.com/search", {
      params: { key: process.env.KEEPA_KEY, domain: 1, type: "product", term: title },
      timeout: 8000,
    });
    const asins = res.data.asinList || [];
    return asins[0] || null;
  } catch {
    return null;
  }
}

// Match a list of supplier products to Amazon ASINs via UPC then title fallback
// Respects Keepa rate limits with 1.1s delay between requests
async function matchSupplierToAmazon(products, onProgress = null) {
  const results = [];
  const total = products.length;

  for (let i = 0; i < total; i++) {
    const p = products[i];
    let asin = null;

    if (p.upc) {
      asin = await lookupAsinByUpc(p.upc);
    }
    if (!asin && p.name) {
      asin = await lookupAsinByTitle(p.name);
    }

    const result = { ...p, asin, matched: !!asin };
    results.push(result);

    if (onProgress) onProgress({ current: i + 1, total, product: p, asin });

    // Keepa free tier: ~1 req/s; paid: higher, but 1.1s is safe
    if (i < total - 1) await new Promise((r) => setTimeout(r, 1100));
  }

  const matched = results.filter((r) => r.matched).length;
  console.log(`[Supplier] Matched ${matched}/${total} products to Amazon ASINs`);

  return results;
}

// Load a supplier CSV and resolve all ASINs in one call
async function loadSupplierFile(filePath, onProgress = null) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".csv") throw new Error(`Unsupported file type: ${ext}. Use CSV.`);

  const products = parseSupplierCSV(filePath);
  console.log(`[Supplier] Loaded ${products.length} products from ${path.basename(filePath)}`);

  return matchSupplierToAmazon(products, onProgress);
}

// Manually register a single product by ASIN + cost (no API call needed)
function addManualProduct(asin, cost, name = "", sku = "") {
  if (!asin || cost <= 0) throw new Error("ASIN and a positive cost are required");
  return { asin, cost, name, sku, quantity: 1, source: "manual", matched: true };
}

// Filter to only products that were successfully matched to an ASIN
function getMatched(products) {
  return products.filter((p) => p.matched && p.asin);
}

// Filter to products that failed to match — useful for manual review
function getUnmatched(products) {
  return products.filter((p) => !p.matched);
}

module.exports = {
  parseSupplierCSV,
  lookupAsinByUpc,
  lookupAsinByTitle,
  matchSupplierToAmazon,
  loadSupplierFile,
  addManualProduct,
  getMatched,
  getUnmatched,
};
