const path = require("path");
const fs = require("fs");

const envCandidates = [
  path.join(__dirname, ".env"),
  process.resourcesPath ? path.join(process.resourcesPath, ".env") : null,
].filter(Boolean);
require("dotenv").config({ path: envCandidates.find((p) => fs.existsSync(p)) || envCandidates[0] });

const express = require("express");
const cors = require("cors");

const { CATEGORY_IDS, getCategoryTree } = require("./backend/keepa");
const { calculateProfit, checkApproval, fallbackCalculate } = require("./backend/selleramp");
const { scoreProduct, summarize } = require("./backend/scorer");
const { loadSupplierFile, addManualProduct } = require("./backend/supplier");
const { scanCategory, scanMultipleCategories, scanSupplierProducts, scanAsin, DEFAULT_OPTIONS } = require("./backend/scanner");
const { runScan, startScheduler, stopScheduler, getStatus, getLastResults } = require("./backend/scheduler");
const { analyzeLead, analyzeLeads, quickTake, findSupplierSources } = require("./backend/ai");
const { checkUngating, hasCredentials } = require("./backend/spapi");

const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────

router.get("/", (req, res) => {
  res.json({
    name: "Sourcr AI",
    status: "online",
    categories: Object.keys(CATEGORY_IDS),
    endpoints: [
      "GET  /health",
      "GET  /categories",
      "GET  /categories/tree",
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

router.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

router.get("/categories", (req, res) => {
  res.json({ categories: Object.keys(CATEGORY_IDS) });
});

router.get("/categories/tree", async (req, res) => {
  try {
    const tree = await getCategoryTree();
    res.json({ tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Scan routes ──────────────────────────────────────────────────────────────

// Scan a single category
// POST /scan/category  { category, options? }
router.post("/scan/category", async (req, res) => {
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
router.post("/scan/categories", async (req, res) => {
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
// POST /scan/asin  { asin, buyPrice?, options? }
router.post("/scan/asin", async (req, res) => {
  const { asin, buyPrice, options } = req.body;

  if (!asin) return res.status(400).json({ error: "asin is required" });

  try {
    const result = await scanAsin(asin, buyPrice ?? null, options);
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
router.post("/scan/supplier", async (req, res) => {
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
router.post("/profit", async (req, res) => {
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
router.post("/approval", async (req, res) => {
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
router.get("/ungating/status", (req, res) => {
  res.json({
    spApiConfigured: hasCredentials(),
    method: hasCredentials() ? "sp-api" : "heuristic",
    marketplaceId: process.env.SP_API_MARKETPLACE_ID || "ATVPDKIKX0DER",
  });
});

// Check ungating status for a single ASIN
// POST /ungating  { asin, category? }
router.post("/ungating", async (req, res) => {
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
router.post("/ai/analyze", async (req, res) => {
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
router.post("/ai/analyze/batch", async (req, res) => {
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
router.post("/ai/quicktake", async (req, res) => {
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
router.post("/supplier/sources", async (req, res) => {
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
router.get("/scheduler/status", (req, res) => {
  res.json(getStatus());
});

// Start the scheduler
// POST /scheduler/start  { cron?, categories?, options? }
router.post("/scheduler/start", (req, res) => {
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
router.post("/scheduler/stop", (req, res) => {
  stopScheduler();
  res.json({ message: "Scheduler stopped" });
});

// Trigger an immediate scan (same as scheduler but on demand)
// POST /scheduler/run  { categories?, options? }
router.post("/scheduler/run", async (req, res) => {
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
router.get("/scheduler/results", (req, res) => {
  const results = getLastResults();
  res.json({ count: results.length, leads: results });
});

// ─── Mount API ────────────────────────────────────────────────────────────────

// The frontend always calls /api/*  — in dev, Vite proxies /api/* here
// unchanged; in production this same Express app serves both the API and
// the built frontend, so the prefix is what tells them apart below.
app.use("/api", router);

// ─── Serve built frontend (production / packaged app) ─────────────────────────

const frontendDist = path.join(__dirname, "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Sourcr AI server running on http://localhost:${PORT}`);
  console.log(`Categories: ${Object.keys(CATEGORY_IDS).join(", ")}`);
  if (process.send) process.send("server-ready");
});
