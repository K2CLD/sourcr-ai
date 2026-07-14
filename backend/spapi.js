const axios = require("axios");

const LWA_URL = "https://api.amazon.com/auth/o2/token";
const SP_API_BASE = "https://sellingpartnerapi-na.amazon.com";
const MARKETPLACE_ID = process.env.SP_API_MARKETPLACE_ID || "ATVPDKIKX0DER";

// Per-category ungating profile used as fallback when SP-API creds aren't set
const CATEGORY_PROFILES = {
  beauty:      { typicallyGated: true,  autoUngate: true,  notes: "Often auto-approved with 90-day+ account history and good health metrics" },
  health:      { typicallyGated: true,  autoUngate: true,  notes: "Often auto-approved with 90-day+ account history and good health metrics" },
  toys:        { typicallyGated: true,  autoUngate: true,  notes: "Auto-ungates Q4 (Oct–Dec) with 3+ months selling history" },
  baby:        { typicallyGated: true,  autoUngate: true,  notes: "May auto-approve with established account and good metrics" },
  grocery:     { typicallyGated: true,  autoUngate: false, notes: "Usually requires invoices and manual Seller Central review" },
  electronics: { typicallyGated: true,  autoUngate: false, notes: "Brand-level gating — most require manual brand approval" },
  pets:        { typicallyGated: false, autoUngate: true,  notes: "Generally open; some premium brands gated" },
  sports:      { typicallyGated: false, autoUngate: true,  notes: "Generally open category" },
  tools:       { typicallyGated: false, autoUngate: true,  notes: "Generally open category" },
  office:      { typicallyGated: false, autoUngate: true,  notes: "Generally open category" },
  kitchen:     { typicallyGated: false, autoUngate: true,  notes: "Generally open category" },
};

let _accessToken = null;
let _tokenExpiry = 0;

function hasCredentials() {
  return !!(
    process.env.SP_API_CLIENT_ID &&
    process.env.SP_API_CLIENT_SECRET &&
    process.env.SP_API_REFRESH_TOKEN &&
    process.env.SP_API_SELLER_ID
  );
}

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;

  const res = await axios.post(
    LWA_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.SP_API_REFRESH_TOKEN,
      client_id: process.env.SP_API_CLIENT_ID,
      client_secret: process.env.SP_API_CLIENT_SECRET,
    }),
    { timeout: 8000 }
  );

  _accessToken = res.data.access_token;
  _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return _accessToken;
}

async function checkViaSpApi(asin) {
  const token = await getAccessToken();

  const res = await axios.get(`${SP_API_BASE}/listings/2021-08-01/restrictions`, {
    params: {
      asin,
      sellerId: process.env.SP_API_SELLER_ID,
      marketplaceIds: MARKETPLACE_ID,
      conditionType: "new",
    },
    headers: {
      "x-amz-access-token": token,
      "x-amz-date": new Date().toISOString().replace(/[:-]/g, "").split(".")[0] + "Z",
    },
    timeout: 10000,
  });

  const restrictions = res.data.restrictions || [];

  if (restrictions.length === 0) {
    return {
      gated: false,
      autoUngatable: true,
      method: "sp-api",
      approvalUrl: null,
      notes: "No restrictions — you can list this item",
    };
  }

  const allLinks = restrictions.flatMap((r) =>
    (r.reasons || []).flatMap((reason) => reason.links || [])
  );
  const approvalLink = allLinks.find(
    (l) => l.title?.toLowerCase().includes("request") || l.resource?.includes("approval")
  );

  return {
    gated: true,
    autoUngatable: !!approvalLink,
    method: "sp-api",
    approvalUrl: approvalLink?.resource || null,
    notes: restrictions[0]?.reasons?.[0]?.message || "Restricted",
  };
}

function checkByCategory(category) {
  const profile = CATEGORY_PROFILES[category];
  if (!profile) {
    return {
      gated: null,
      autoUngatable: null,
      method: "heuristic",
      approvalUrl: null,
      notes: "Category not profiled — check Seller Central",
    };
  }
  return {
    gated: profile.typicallyGated,
    autoUngatable: profile.autoUngate,
    method: "heuristic",
    approvalUrl: null,
    notes: profile.notes,
  };
}

async function checkUngating(asin, category) {
  if (hasCredentials()) {
    try {
      return await checkViaSpApi(asin);
    } catch (err) {
      console.warn(`[SP-API] ungating check failed for ${asin}: ${err.message}`);
    }
  }
  return checkByCategory(category);
}

async function batchCheckUngating(products) {
  const results = await Promise.allSettled(
    products.map((p) => checkUngating(p.asin, p.category))
  );

  return products.map((p, i) => ({
    ...p,
    ungating:
      results[i].status === "fulfilled"
        ? results[i].value
        : { gated: null, autoUngatable: null, method: "error", approvalUrl: null, notes: "Check failed" },
  }));
}

module.exports = { checkUngating, batchCheckUngating, hasCredentials };
