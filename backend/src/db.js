/**
 * Database layer — Supabase (PostgreSQL)
 * All exports are async functions instead of prepared statements.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Seed default settings on startup ─────────────────────────────────────────

const defaultSettings = {
    keywords_ai: 'new grad AI engineer,new grad machine learning engineer,entry level AI engineer,2026 new grad AI',
    keywords_swe: 'new grad software engineer,entry level software engineer,2026 new grad SWE,new grad full stack',
    keywords_data: 'new grad data scientist,new grad data engineer,entry level data scientist,new grad analytics engineer',
    scrape_interval_minutes: '30',
    filter_exclude_senior: 'true',
    slack_enabled: 'false',
    slack_webhook_url: '',
    dream_companies: 'openai,anthropic,google,meta,apple,stripe,databricks',
    digest_interval_hours: '6',
    frontend_url: 'http://localhost:3000',
    job_checker_enabled: 'true',
};

export async function seedSettings() {
    for (const [key, value] of Object.entries(defaultSettings)) {
        await supabase
            .from('settings')
            .upsert({ key, value }, { onConflict: 'key', ignoreDuplicates: true });
    }
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export async function insertJob(job) {
    const { data, error } = await supabase
        .from('jobs')
        .upsert({
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location || null,
            url: job.url,
            source: job.source,
            category: job.category,
            salary: job.salary || null,
            description: job.description || null,
            posted_at: job.posted_at || null,
            status: 'new',
            is_new: true,
        }, { onConflict: 'id', ignoreDuplicates: true })
        .select();

    if (error && !error.message.includes('duplicate')) {
        throw error;
    }
    // ignoreDuplicates: returns empty array for existing rows, array with row for new
    return { changes: data && data.length > 0 ? 1 : 0 };
}

export async function jobExistsByTitleCompany(title, company) {
    const { data } = await supabase
        .from('jobs')
        .select('id')
        .eq('title', title)
        .eq('company', company)
        .limit(1);
    return data && data.length > 0 ? data[0] : null;
}

export async function getJobs(params) {
    let query = supabase
        .from('jobs')
        .select('*', { count: 'exact' });

    if (params.status) query = query.eq('status', params.status);
    if (params.category) query = query.eq('category', params.category);
    if (params.source) query = query.eq('source', params.source);
    if (params.search) {
        const term = params.search.replace(/[%_]/g, '');
        if (term) query = query.or(`title.ilike.%${term}%,company.ilike.%${term}%`);
    }

    query = query
        .order('posted_at', { ascending: false, nullsFirst: false })
        .order('scraped_at', { ascending: false })
        .range(params.offset, params.offset + params.limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;
    return { jobs: data || [], total: count || 0 };
}

export async function updateJobStatus(status, id) {
    const { error } = await supabase
        .from('jobs')
        .update({ status, is_new: false })
        .eq('id', id);
    if (error) throw error;
}

export async function markAllSeen() {
    const { error } = await supabase
        .from('jobs')
        .update({ is_new: false })
        .eq('is_new', true);
    if (error) throw error;
}

export async function getStats() {
    // Use RPC function or multiple queries
    const { data, error } = await supabase.rpc('get_job_stats');
    if (error) {
        // Fallback: manual queries if RPC not set up yet
        const { count: total } = await supabase.from('jobs').select('*', { count: 'exact', head: true });
        const { count: new_count } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('is_new', true);
        const { count: applied } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'applied');
        const { count: saved } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'saved');
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: last_24h } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).gte('scraped_at', since24h);
        return { total: total || 0, new_count: new_count || 0, applied: applied || 0, saved: saved || 0, last_24h: last_24h || 0 };
    }
    return data;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getAllSettings() {
    const { data, error } = await supabase
        .from('settings')
        .select('key, value');
    if (error) throw error;
    return Object.fromEntries((data || []).map(r => [r.key, r.value]));
}

export async function upsertSetting(key, value) {
    const { error } = await supabase
        .from('settings')
        .upsert({ key, value: String(value) }, { onConflict: 'key' });
    if (error) throw error;
}

// ── Scrape Runs ──────────────────────────────────────────────────────────────

export async function startScrapeRun() {
    const { data, error } = await supabase
        .from('scrape_runs')
        .insert({ started_at: new Date().toISOString() })
        .select('id')
        .single();
    if (error) throw error;
    return data.id;
}

export async function finishScrapeRun(jobsFound, jobsNew, errors, runId) {
    const { error } = await supabase
        .from('scrape_runs')
        .update({
            finished_at: new Date().toISOString(),
            jobs_found: jobsFound,
            jobs_new: jobsNew,
            errors: errors,
        })
        .eq('id', runId);
    if (error) throw error;
}

export async function getLastScrapeRun() {
    // Return the last COMPLETED run (finished_at is not null)
    const { data, error } = await supabase
        .from('scrape_runs')
        .select('*')
        .not('finished_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data || null;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export async function deleteOldJobs() {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('jobs')
        .delete()
        .not('status', 'in', '("saved","applied")')
        .lt('scraped_at', cutoff)
        .select('id');
    if (error) throw error;
    return { changes: data ? data.length : 0 };
}

// ── Digest helpers ───────────────────────────────────────────────────────────

export async function getNewJobsSince(since) {
    const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('is_new', true)
        .gte('scraped_at', since)
        .order('scraped_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

// ── Job Checker ──────────────────────────────────────────────────────────────

export async function getActiveJobUrls() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('jobs')
        .select('id, url, company, title')
        .not('status', 'in', '("closed","ignored")')
        .gte('scraped_at', cutoff)
        .order('scraped_at', { ascending: false })
        .limit(500);
    if (error) throw error;
    return data || [];
}

export async function markJobClosed(id) {
    const { error } = await supabase
        .from('jobs')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

// ── Initialize ───────────────────────────────────────────────────────────────

export async function initDB() {
    await seedSettings();
    console.log('✅ Supabase connected & settings seeded');
}

export default supabase;
