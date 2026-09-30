require("dotenv").config();
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const { scanMultipleCategories, rankByConfidence } = require("./scanner");
const { summarize } = require("./scorer");
const { saveScan } = require("./supabase");

const DEFAULT_CATEGORIES = ["beauty", "kitchen", "health", "toys", "pets"];

const DEFAULT_SCAN_OPTIONS = {
  minROI: 30,
  minProfit: 3,
  minGrade: "B",
  maxBSR: 30000,
  pages: 2,
};

let scheduledTask = null;
let lastResults = [];
let lastRunAt = null;

// ─── Email ────────────────────────────────────────────────────────────────────

function createMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function buildEmailHTML(results) {
  if (!results.length) return "<p>No profitable leads found in this scan.</p>";

  const rows = results
    .slice(0, 25)
    .map((p) => {
      const pd = p.profitData || {};
      const gradeColor = { A: "#22c55e", B: "#3b82f6", C: "#f59e0b", D: "#ef4444" }[p.grade] || "#6b7280";
      return `
        <tr>
          <td><a href="${p.url}" style="color:#1d4ed8">${p.asin}</a></td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title || "N/A"}</td>
          <td>${p.category || ""}</td>
          <td>$${p.price}</td>
          <td>$${pd.profit}</td>
          <td>${pd.roi}%</td>
          <td>${p.bsr?.toLocaleString()}</td>
          <td style="color:${gradeColor};font-weight:bold">${p.grade} (${p.score})</td>
        </tr>`;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family:sans-serif;color:#111;max-width:900px;margin:0 auto;padding:20px">
      <h2 style="margin:0 0 4px">Sourcr AI — ${results.length} Profitable Leads</h2>
      <p style="color:#6b7280;margin:0 0 16px;font-size:13px">Scanned at ${new Date().toLocaleString()}</p>
      <table border="0" cellpadding="8" cellspacing="0" width="100%"
             style="border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb">
        <thead>
          <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
            <th align="left">ASIN</th>
            <th align="left">Title</th>
            <th align="left">Category</th>
            <th align="left">Price</th>
            <th align="left">Profit</th>
            <th align="left">ROI</th>
            <th align="left">BSR</th>
            <th align="left">Grade</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${results.length > 25 ? `<p style="color:#6b7280;font-size:12px">Showing top 25 of ${results.length} leads.</p>` : ""}
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb">
      <p style="color:#9ca3af;font-size:11px">Sourcr AI · Automated Amazon Sourcing</p>
    </body>
    </html>`;
}

async function sendAlert(results) {
  if (!process.env.SMTP_USER || !process.env.ALERT_EMAIL) {
    console.log("[Scheduler] SMTP not configured — skipping email alert");
    return;
  }

  const mailer = createMailer();
  await mailer.sendMail({
    from: `Sourcr AI <${process.env.SMTP_USER}>`,
    to: process.env.ALERT_EMAIL,
    subject: `Sourcr AI — ${results.length} leads found · ${new Date().toLocaleDateString()}`,
    html: buildEmailHTML(results),
  });

  console.log(`[Scheduler] Alert email sent to ${process.env.ALERT_EMAIL}`);
}

// ─── Core scan runner ─────────────────────────────────────────────────────────

async function runScan(categories = DEFAULT_CATEGORIES, options = DEFAULT_SCAN_OPTIONS) {
  console.log(`[Scheduler] Starting scan at ${new Date().toISOString()}`);
  console.log(`[Scheduler] Categories: ${categories.join(", ")}`);

  try {
    const results = await scanMultipleCategories(categories, options);
    const top = rankByConfidence(results); // full `results` still saved below — this is display/alert-only
    lastResults = top;
    lastRunAt = new Date().toISOString();

    console.log(`[Scheduler] Scan complete — ${results.length} leads found`);
    top.slice(0, 5).forEach((p) => console.log(summarize(p)));

    const warning = results.partialErrors
      ? `Some categories failed and were skipped: ${results.partialErrors.map((e) => `${e.category} (${e.message})`).join("; ")}`
      : undefined;
    saveScan({ categories, options, leads: results, warning }).catch((err) => {
      console.warn(`[Supabase] Failed to auto-save scheduled scan: ${err.message}`);
    });

    if (top.length > 0) {
      await sendAlert(top);
    }

    return top;
  } catch (err) {
    console.error("[Scheduler] Scan failed:", err.message);
    throw err;
  }
}

// ─── Schedule management ──────────────────────────────────────────────────────

// Start recurring scans on a cron schedule
// Default: every 6 hours  →  '0 */6 * * *'
// Daily at 8am            →  '0 8 * * *'
// Every 30 minutes        →  '*/30 * * * *'
function startScheduler(cronExpr = "0 */6 * * *", categories = DEFAULT_CATEGORIES, options = DEFAULT_SCAN_OPTIONS) {
  if (!cron.validate(cronExpr)) throw new Error(`Invalid cron expression: ${cronExpr}`);

  if (scheduledTask) {
    scheduledTask.stop();
    console.log("[Scheduler] Replaced existing schedule");
  }

  scheduledTask = cron.schedule(cronExpr, () => runScan(categories, options));
  console.log(`[Scheduler] Scheduled — cron: "${cronExpr}"`);

  return scheduledTask;
}

function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log("[Scheduler] Stopped");
  }
}

function getStatus() {
  return {
    running: !!scheduledTask,
    lastRunAt,
    leadCount: lastResults.length,
  };
}

function getLastResults() {
  return lastResults;
}

module.exports = {
  runScan,
  startScheduler,
  stopScheduler,
  getStatus,
  getLastResults,
  sendAlert,
};
