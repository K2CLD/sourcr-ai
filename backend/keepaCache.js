const fs = require("fs");
const path = require("path");

// Persists fetched Keepa product data across scans/app restarts so re-scanning
// the same categories (e.g. the scheduler running every few hours) doesn't
// re-spend tokens on ASINs whose data hasn't gone stale yet.
const CACHE_FILE = path.join(process.env.SOURCR_DATA_DIR || path.join(__dirname, "..", "database"), "keepa-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// Bump whenever keepa.js parseProduct's output changes, so entries parsed by older code are
// refetched instead of trusted. v2: real Buy Box index (18, was 28 = eBay), 90-day
// min/max via minInInterval/maxInInterval, rating/reviews, basic vs full entries.
// v3: categoryPath.
const CACHE_VERSION = 3;

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

// key: an ASIN, or "<ASIN>:full" for a buybox + rating fetch
function get(key) {
  const entry = load()[key];
  if (!entry || entry.v !== CACHE_VERSION || Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry.data;
}

function set(key, data) {
  load()[key] = { data, fetchedAt: Date.now(), v: CACHE_VERSION };
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

// Every unexpired, current-version entry as [key, data] — for estimating how much of a
// rescan the cache will cover (keepaTokens.js).
function freshEntries() {
  const now = Date.now();
  return Object.entries(load())
    .filter(([, e]) => e.v === CACHE_VERSION && now - e.fetchedAt <= CACHE_TTL_MS)
    .map(([key, e]) => [key, e.data]);
}

module.exports = { get, set, flush, freshEntries };
