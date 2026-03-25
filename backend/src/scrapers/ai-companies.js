/**
 * AI Companies Scraper — 113 verified companies with confirmed API endpoints.
 * No runtime probing. Each company has a verified ATS type (ashby/greenhouse/lever)
 * and confirmed slug that returns real job data.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeJobId, isSeniorRole, classifyCategory, sleep } from '../utils/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let companies = [];
try {
    companies = JSON.parse(readFileSync(join(__dirname, '../data/verified_ai_companies.json'), 'utf-8'));
    console.log(`📂 AI Companies: loaded ${companies.length} verified companies`);
} catch (err) {
    console.warn(`⚠️  verified_ai_companies.json not found: ${err.message}`);
}

const NEW_GRAD_KW = [
    'new grad', 'new graduate', 'entry level', 'entry-level',
    'junior', '2025', '2026', 'university', 'campus',
    'associate', 'early career', 'recent grad',
];

function isNewGrad(title) {
    return NEW_GRAD_KW.some(kw => title.toLowerCase().includes(kw));
}

// ── ATS Fetchers ─────────────────────────────────────────────────────────────

async function fetchAshby(slug) {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, {
        headers: { 'User-Agent': 'JobHunterPro/1.0' },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return d.jobs || [];
}

async function fetchGreenhouse(slug) {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`, {
        headers: { 'User-Agent': 'JobHunterPro/1.0' },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return d.jobs || [];
}

async function fetchLever(slug) {
    const r = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
        headers: { 'User-Agent': 'JobHunterPro/1.0' },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
}

// ── ATS Parsers ──────────────────────────────────────────────────────────────

function parseAshby(rawJobs, company, filterSenior) {
    const out = [];
    for (const j of rawJobs) {
        const title = j.title || '';
        if (!isNewGrad(title)) continue;
        if (filterSenior && isSeniorRole(title)) continue;
        const url = j.jobUrl || `https://jobs.ashbyhq.com/${company.slug}/${j.id}`;
        out.push({
            id: makeJobId(url), title, company: company.name,
            location: j.location || 'US', url,
            source: 'ai-companies', category: classifyCategory(title, company.category),
            salary: null, description: (j.descriptionPlain || '').slice(0, 500) || null,
            posted_at: j.publishedAt ? new Date(j.publishedAt).toISOString() : new Date().toISOString(),
        });
    }
    return out;
}

function parseGreenhouse(rawJobs, company, filterSenior) {
    const out = [];
    for (const j of rawJobs) {
        const title = j.title || '';
        if (!isNewGrad(title)) continue;
        if (filterSenior && isSeniorRole(title)) continue;
        const url = j.absolute_url || `https://boards.greenhouse.io/${company.slug}/jobs/${j.id}`;
        out.push({
            id: makeJobId(url), title, company: company.name,
            location: j.location?.name || 'US', url,
            source: 'ai-companies', category: classifyCategory(title, company.category),
            salary: null, description: j.content ? j.content.replace(/<[^>]*>/g, '').slice(0, 500) : null,
            posted_at: j.updated_at ? new Date(j.updated_at).toISOString() : new Date().toISOString(),
        });
    }
    return out;
}

function parseLever(rawJobs, company, filterSenior) {
    const out = [];
    for (const p of rawJobs) {
        const title = p.text || '';
        if (!isNewGrad(title)) continue;
        if (filterSenior && isSeniorRole(title)) continue;
        const url = p.hostedUrl || `https://jobs.lever.co/${company.slug}/${p.id}`;
        out.push({
            id: makeJobId(url), title, company: company.name,
            location: p.categories?.location || 'US', url,
            source: 'ai-companies', category: classifyCategory(title, company.category),
            salary: null, description: (p.descriptionPlain || '').slice(0, 500) || null,
            posted_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
        });
    }
    return out;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

const FETCHERS = {
    ashby: fetchAshby,
    greenhouse: fetchGreenhouse,
    lever: fetchLever,
};

const PARSERS = {
    ashby: parseAshby,
    greenhouse: parseGreenhouse,
    lever: parseLever,
};

export async function scrapeAICompanies(filterSenior = true) {
    if (companies.length === 0) return [];

    console.log(`\n🤖 AI Companies: scraping ${companies.length} verified companies...`);

    const allJobs = [];
    let hits = 0;
    let errors = 0;

    // Process in batches of 15 concurrent requests
    const BATCH_SIZE = 15;
    for (let i = 0; i < companies.length; i += BATCH_SIZE) {
        const batch = companies.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(batch.map(async (co) => {
            const fetcher = FETCHERS[co.ats];
            const parser = PARSERS[co.ats];
            if (!fetcher || !parser) return { co, jobs: [] };

            const rawJobs = await fetcher(co.slug);
            const jobs = parser(rawJobs, co, filterSenior);
            return { co, jobs, total: rawJobs.length };
        }));

        for (const r of results) {
            if (r.status === 'fulfilled') {
                if (r.value.jobs.length > 0) {
                    allJobs.push(...r.value.jobs);
                    hits++;
                    console.log(`   ✅ ${r.value.co.name}: ${r.value.jobs.length} new-grad jobs (${r.value.total} total via ${r.value.co.ats})`);
                }
            } else {
                errors++;
            }
        }

        await sleep(200);
    }

    console.log(`✅ AI Companies done: ${allJobs.length} new-grad jobs from ${hits}/${companies.length} companies (${errors} errors)`);
    return allJobs;
}
