const fs = require("fs");
const path = require("path");

// Persists fetched Keepa product data across scans/app restarts so re-scanning
// the same categories (e.g. the scheduler running every few hours) doesn't
// re-spend tokens on ASINs whose data hasn't gone stale yet.
const CACHE_FILE = path.join(__dirname, "..", "database", "keepa-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cache = null; // lazy-loaded, kept in memory for the process lifetime
let dirty = false;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function get(asin) {
  const entry = load()[asin];
  if (!entry || Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry.data;
}

function set(asin, data) {
  load()[asin] = { data, fetchedAt: Date.now() };
  dirty = true;
}

// Called once per fetchDetails batch run rather than per-ASIN, so a scan that
// touches hundreds of ASINs does one disk write instead of hundreds.
function flush() {
  if (!dirty) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    dirty = false;
  } catch (err) {
    console.warn(`[KeepaCache] Failed to persist cache: ${err.message}`);
  }
}

module.exports = { get, set, flush };
