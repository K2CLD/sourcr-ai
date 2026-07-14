require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { CATEGORY_IDS } = require("./backend/keepa");
const { calculateProfit, checkApproval, fallbackCalculate } = require("./backend/selleramp");
const { scoreProduct, summarize } = require("./backend/scorer");
const { loadSupplierFile, addManualProduct } = require("./backend/supplier");
const { scanCategory, scanMultipleCategories, scanSupplierProducts, scanAsin, DEFAULT_OPTIONS } = require("./backend/scanner");
const { runScan, startScheduler, stopScheduler, getStatus, getLastResults } = require("./backend/scheduler");
const { analyzeLead, analyzeLeads, quickTake, findSupplierSources } = require("./backend/ai");
const { checkUngating, hasCredentials } = require("./backend/spapi");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    name: "Sourcr AI",
    status: "online",
    categories: Object.keys(CATEGORY_IDS),
    endpoints: [
      "GET  /health",
      "GET  /categories",
      "POST /scan/category",
      "POST /scan/categories",
      "POST /scan/asin",
      "POST /scan/supplier",
      "POST /profit",
      "POST /approval",
      "GET  /scheduler/status",
      "POST /scheduler/start",
      "POST /scheduler/stop",
      "POST /scheduler/run",
      "GET  /scheduler/results",
      "POST /ungating",
      "GET  /ungating/status",
    ],
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get("/categories", (req, res) => {
  res.json({ categories: Object.keys(CATEGORY_IDS) });
});

// ─── Scan routes ──────────────────────────────────────────────────────────────

// Scan a single category
// POST /scan/category  { category, options? }
app.post("/scan/category", async (req, res) => {
  const { category, options } = req.body;

  if (!category) return res.status(400).json({ error: "category is required" });
  if (!CATEGORY_IDS[category]) {
    return res.status(400).json({ error: `Unknown category. Valid: ${Object.keys(CATEGORY_IDS).join(", ")}` });
  }

  try {
    const leads = await scanCategory(category, options);
    res.json({ category, count: leads.length, leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Scan multiple categories
// POST /scan/categories  { categories?, options? }
app.post("/scan/categories", async (req, res) => {
  const { categories = Object.keys(CATEGORY_IDS), options } = req.body;

  const invalid = categories.filter((c) => !CATEGORY_IDS[c]);
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown categories: ${invalid.join(", ")}` });
  }

  try {
    const leads = await scanMultipleCategories(categories, options);
    res.json({ categories, count: leads.length, leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Scan a single ASIN
// POST /scan/asin  { asin, buyPrice? }
app.post("/scan/asin", async (req, res) => {
  const { asin, buyPrice } = req.body;

  if (!asin) return res.status(400).json({ error: "asin is required" });

  try {
    const result = await scanAsin(asin, buyPrice ?? null);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Scan supplier products from an uploaded CSV or a manual list of { asin, cost } pairs
// POST /scan/supplier  { filePath?, products?, options? }
//   filePath — absolute path to a supplier CSV on the server
//   products — array of { asin, cost, name? } for manual entry
app.post("/scan/supplier", async (req, res) => {
  const { filePath, products, options } = req.body;

  if (!filePath && !products?.length) {
    return res.status(400).json({ error: "Provide filePath (CSV) or products array" });
  }

  try {
    let supplierProducts;

    if (filePath) {
      supplierProducts = await loadSupplierFile(filePath);
    } else {
      supplierProducts = products.map((p) => addManualProduct(p.asin, p.cost, p.name));
    }

    const leads = await scanSupplierProducts(supplierProducts, options);
    res.json({ count: leads.length, leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Profit & approval ────────────────────────────────────────────────────────

// Calculate FBA profit for an ASIN at a given buy price
// POST /profit  { asin, buyPrice }
app.post("/profit", async (req, res) => {
  const { asin, buyPrice } = req.body;

  if (!asin || buyPrice == null) {
    return res.status(400).json({ error: "asin and buyPrice are required" });
  }

  try {
    const result = await calculateProfit(asin, parseFloat(buyPrice));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Check if a product is restricted / gated
// POST /approval  { asin }
app.post("/approval", async (req, res) => {
  const { asin } = req.body;

  if (!asin) return res.status(400).json({ error: "asin is required" });

  try {
    const result = await checkApproval(asin);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Ungating routes ──────────────────────────────────────────────────────────

// Check SP-API integration status
// GET /ungating/status
app.get("/ungating/status", (req, res) => {
  res.json({
    spApiConfigured: hasCredentials(),
    method: hasCredentials() ? "sp-api" : "heuristic",
    marketplaceId: process.env.SP_API_MARKETPLACE_ID || "ATVPDKIKX0DER",
  });
});

// Check ungating status for a single ASIN
// POST /ungating  { asin, category? }
app.post("/ungating", async (req, res) => {
  const { asin, category } = req.body;
  if (!asin) return res.status(400).json({ error: "asin is required" });

  try {
    const result = await checkUngating(asin, category || null);
    res.json({ asin, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── AI analysis routes ───────────────────────────────────────────────────────

// Analyze a single lead with full AI verdict
// POST /ai/analyze  { lead }
app.post("/ai/analyze", async (req, res) => {
  const { lead } = req.body;
  if (!lead?.asin) return res.status(400).json({ error: "lead object with asin is required" });

  try {
    const analysis = await analyzeLead(lead);
    res.json({ asin: lead.asin, analysis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Analyze a batch of leads (up to 20)
// POST /ai/analyze/batch  { leads }
app.post("/ai/analyze/batch", async (req, res) => {
  const { leads } = req.body;
  if (!Array.isArray(leads) || !leads.length) return res.status(400).json({ error: "leads array is required" });
  if (leads.length > 20) return res.status(400).json({ error: "Max 20 leads per batch" });

  try {
    const results = await analyzeLeads(leads);
    res.json({ count: results.length, leads: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Quick one-sentence take on a lead (uses Haiku — fast + cheap)
// POST /ai/quicktake  { lead }
app.post("/ai/quicktake", async (req, res) => {
  const { lead } = req.body;
  if (!lead?.asin) return res.status(400).json({ error: "lead object with asin is required" });

  try {
    const take = await quickTake(lead);
    res.json({ asin: lead.asin, take });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Find off-Amazon sourcing options for a product
// POST /supplier/sources  { lead }
app.post("/supplier/sources", async (req, res) => {
  const { lead } = req.body;
  if (!lead?.asin) return res.status(400).json({ error: "lead object with asin is required" });
  try {
    const sources = await findSupplierSources(lead);
    res.json({ asin: lead.asin, sources });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Scheduler routes ─────────────────────────────────────────────────────────

// GET /scheduler/status
app.get("/scheduler/status", (req, res) => {
  res.json(getStatus());
});

// Start the scheduler
// POST /scheduler/start  { cron?, categories?, options? }
app.post("/scheduler/start", (req, res) => {
  const { cron = "0 */6 * * *", categories, options } = req.body;

  try {
    startScheduler(cron, categories, options);
    res.json({ message: "Scheduler started", cron });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Stop the scheduler
// POST /scheduler/stop
app.post("/scheduler/stop", (req, res) => {
  stopScheduler();
  res.json({ message: "Scheduler stopped" });
});

// Trigger an immediate scan (same as scheduler but on demand)
// POST /scheduler/run  { categories?, options? }
app.post("/scheduler/run", async (req, res) => {
  const { categories, options } = req.body;

  try {
    const leads = await runScan(categories, options);
    res.json({ count: leads.length, leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /scheduler/results — return results from the last scheduled scan
app.get("/scheduler/results", (req, res) => {
  const results = getLastResults();
  res.json({ count: results.length, leads: results });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Sourcr AI server running on http://localhost:${PORT}`);
  console.log(`Categories: ${Object.keys(CATEGORY_IDS).join(", ")}`);
});
