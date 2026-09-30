const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

// Persist a completed scan (its leads, in full, exactly as scanner.js produced them) so
// browsing it later never needs to touch Keepa again.
async function saveScan({ categories, options, leads, warning }) {
  const { data: scan, error: scanErr } = await supabase
    .from("scans")
    .insert({ categories, options, lead_count: leads.length, warning: warning || null })
    .select()
    .single();
  if (scanErr) throw scanErr;

  if (leads.length) {
    const rows = leads.map((lead) => ({ scan_id: scan.id, asin: lead.asin, data: lead }));
    const { error: leadsErr } = await supabase.from("scan_leads").insert(rows);
    if (leadsErr) throw leadsErr;
  }

  return scan;
}

async function listScans({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from("scans")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function getScan(scanId) {
  const { data, error } = await supabase.from("scans").select("*").eq("id", scanId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getScanLeads(scanId) {
  const { data, error } = await supabase
    .from("scan_leads")
    .select("data")
    .eq("scan_id", scanId);
  if (error) throw error;
  return data.map((row) => row.data);
}

async function deleteScan(scanId) {
  const { error } = await supabase.from("scans").delete().eq("id", scanId);
  if (error) throw error;
}

module.exports = { supabase, saveScan, listScans, getScan, getScanLeads, deleteScan };
