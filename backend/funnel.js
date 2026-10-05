// Per-scan funnel accounting: how many items enter/leave each pipeline stage, why each
// dropped ASIN was rejected, and which ASINs were dropped for MISSING data (null price,
// BSR, ROI, ...) as opposed to failing a threshold. Every stage is logged as it runs;
// printSummary() prints the whole funnel as a table at the end of a scan.

class ScanFunnel {
  constructor(label) {
    this.label = label;
    this.rows = [];        // { scope, stage, in, out, note }
    this.nullDrops = [];   // { scope, stage, asin, fields }
    this.missingKept = {}; // field -> count of items missing it that a check skipped over (not dropped)
  }

  // rejected: [{ asin, reason, missing? }] — `missing` (array of field names) marks a drop
  // caused by null/missing data; those are also recorded separately in nullDrops.
  stage(stage, inCount, outCount, rejected = [], note = "") {
    this.rows.push({ scope: this.label, stage, in: inCount, out: outCount, note });
    const inStr = inCount == null ? "-" : inCount;
    console.log(`[Funnel][${this.label}] ${stage}: ${inStr} in -> ${outCount} out${note ? ` (${note})` : ""}`);

    for (const r of rejected) {
      if (r.missing?.length) {
        this.nullDrops.push({ scope: this.label, stage, asin: r.asin, fields: r.missing });
        console.log(`[Funnel][${this.label}]   NULL ${r.asin} — ${r.reason}`);
      } else {
        console.log(`[Funnel][${this.label}]   x ${r.asin} — ${r.reason}`);
      }
    }
  }

  missing(field, n = 1) {
    this.missingKept[field] = (this.missingKept[field] || 0) + n;
  }

  absorb(other) {
    if (!other) return;
    this.rows.push(...other.rows);
    this.nullDrops.push(...other.nullDrops);
    for (const [field, n] of Object.entries(other.missingKept)) this.missing(field, n);
  }

  printSummary(title = `Scan funnel — ${this.label}`) {
    const lines = [];
    const categoryScopes = new Set(this.rows.map((r) => r.scope).filter((s) => s !== this.label));
    const multiScope = categoryScopes.size > 1;

    const tableRows = this.rows.map((r) => ({
      scope: r.scope,
      stage: r.stage,
      in: r.in == null ? "-" : String(r.in),
      out: String(r.out),
      dropped: r.in == null ? "-" : String(r.in - r.out),
      note: r.note || "",
    }));

    // Stage totals across categories, in first-seen stage order
    if (multiScope) {
      const totals = new Map();
      for (const r of this.rows) {
        if (r.scope === this.label) continue; // scan-level rows (dedupe/top-N) are already totals
        const t = totals.get(r.stage) || { in: 0, out: 0, hasIn: false };
        if (r.in != null) { t.in += r.in; t.hasIn = true; }
        t.out += r.out;
        totals.set(r.stage, t);
      }
      for (const [stage, t] of totals) {
        tableRows.push({
          scope: "ALL",
          stage,
          in: t.hasIn ? String(t.in) : "-",
          out: String(t.out),
          dropped: t.hasIn ? String(t.in - t.out) : "-",
          note: "",
        });
      }
      // Keep scan-level rows last so the ALL block reads top-to-bottom as one funnel
      tableRows.sort((a, b) => (a.scope === this.label) - (b.scope === this.label));
    }

    const cols = [
      ["scope", "Scope"], ["stage", "Stage"], ["in", "In"], ["out", "Out"], ["dropped", "Dropped"], ["note", "Note"],
    ];
    const widths = cols.map(([k, h]) => Math.max(h.length, ...tableRows.map((r) => r[k].length)));
    const fmt = (vals) => vals.map((v, i) => (i >= 2 && i <= 4 ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join(" | ");
    const sep = widths.map((w) => "-".repeat(w)).join("-+-");

    lines.push("", `========== ${title} ==========`);
    lines.push(fmt(cols.map(([, h]) => h)), sep);
    let prevScope = null;
    for (const r of tableRows) {
      if (prevScope !== null && r.scope !== prevScope) lines.push(sep);
      lines.push(fmt(cols.map(([k]) => r[k])));
      prevScope = r.scope;
    }

    lines.push("", `Dropped for null/missing fields: ${this.nullDrops.length}`);
    if (this.nullDrops.length) {
      const byField = {};
      for (const d of this.nullDrops) {
        const key = `${d.stage}: ${d.fields.join("+")}`;
        byField[key] = (byField[key] || 0) + 1;
      }
      for (const [k, n] of Object.entries(byField)) lines.push(`  ${n}x  ${k}`);
      for (const d of this.nullDrops) lines.push(`    ${d.asin} [${d.scope}] ${d.stage} — missing ${d.fields.join(", ")}`);
    }

    const kept = Object.entries(this.missingKept);
    if (kept.length) {
      lines.push("", "Missing but NOT dropped (check skipped for null data):");
      for (const [field, n] of kept) lines.push(`  ${n}x  ${field}`);
    }
    lines.push("=".repeat(title.length + 22), "");

    console.log(lines.join("\n"));
  }
}

function createFunnel(label) {
  return new ScanFunnel(label);
}

module.exports = { createFunnel, ScanFunnel };
