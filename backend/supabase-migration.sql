-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    url TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    category TEXT NOT NULL,
    salary TEXT,
    description TEXT,
    posted_at TIMESTAMPTZ,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'new',
    is_new BOOLEAN NOT NULL DEFAULT true,
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at ON jobs(scraped_at);
CREATE INDEX IF NOT EXISTS idx_jobs_is_new ON jobs(is_new);

-- Scrape runs table
CREATE TABLE IF NOT EXISTS scrape_runs (
    id BIGSERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    jobs_found INTEGER DEFAULT 0,
    jobs_new INTEGER DEFAULT 0,
    errors TEXT
);

-- Settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- RPC function for aggregated stats (avoids multiple round trips)
CREATE OR REPLACE FUNCTION get_job_stats()
RETURNS JSON AS $$
  SELECT json_build_object(
    'total', COUNT(*),
    'new_count', COUNT(*) FILTER (WHERE is_new = true),
    'applied', COUNT(*) FILTER (WHERE status = 'applied'),
    'saved', COUNT(*) FILTER (WHERE status = 'saved'),
    'last_24h', COUNT(*) FILTER (WHERE scraped_at >= now() - interval '24 hours')
  )
  FROM jobs;
$$ LANGUAGE sql;

-- Enable Row Level Security (but allow all for service_role)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Policies: service_role bypasses RLS automatically, but add anon read for jobs
CREATE POLICY "Allow service_role full access to jobs" ON jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service_role full access to scrape_runs" ON scrape_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service_role full access to settings" ON settings FOR ALL USING (true) WITH CHECK (true);
