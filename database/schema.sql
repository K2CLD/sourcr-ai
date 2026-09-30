-- Sourcr AI — scan history schema
-- Run this once in the Supabase project's SQL Editor (Dashboard > SQL Editor > New query).
-- The app's secret API key can read/write these tables but cannot run DDL, so table
-- creation has to happen here rather than from the app itself.

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  categories jsonb not null default '[]'::jsonb,  -- categories requested for this scan
  options jsonb not null default '{}'::jsonb,      -- the filter options used (minROI, minPrice, etc.)
  lead_count int not null default 0,
  warning text                                      -- partial-failure message, if any (see scanMultipleCategories)
);

create table if not exists scan_leads (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  asin text not null,
  data jsonb not null,  -- the full lead object exactly as scanner.js produced it
  created_at timestamptz not null default now()
);

create index if not exists scan_leads_scan_id_idx on scan_leads(scan_id);
create index if not exists scan_leads_asin_idx on scan_leads(asin);

-- RLS is intentionally left at its default (off for a freshly created table). Only this
-- app's backend talks to Supabase, using the secret key server-side — the secret key
-- bypasses RLS entirely, and the frontend never calls Supabase directly — so RLS policies
-- would add complexity without changing this app's actual access model.
