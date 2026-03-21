/**
 * AI Companies Scraper — 200+ US AI companies
 * Probes Greenhouse & Lever APIs, falls back to Playwright.
 * Runs alongside the general career-pages scraper.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeJobId, isSeniorRole, classifyCategory, sleep } from '../utils/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let aiCompanies = [];
try { aiCompanies = JSON.parse(readFileSync(join(__dirname, '../data/ai_companies.json'), 'utf-8')); }
catch { console.warn('⚠️  ai_companies.json not found — AI companies scraper disabled'); }

const NEW_GRAD_KW = [
    'new grad', 'new graduate', 'entry level', 'entry-level',
    'junior', '2025', '2026', 'university', 'campus',
    'associate', 'early career', 'recent grad',
];

function isNewGrad(title) {
    const t = title.toLowerCase();
    return NEW_GRAD_KW.some(kw => t.includes(kw));
}

async function probeGreenhouse(slug) {
    try {
        const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
            headers: { 'User-Agent': 'JobHunterPro/1.0' },
            signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return null;
        const d = await r.json();
        return d.jobs?.length ? d.jobs : null;
    } catch { return null; }
}

async function probeLever(slug) {
    try {
        const r = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
            headers: { 'User-Agent': 'JobHunterPro/1.0' },
            signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return null;
        const d = await r.json();
        return Array.isArray(d) && d.length ? d : null;
    } catch { return null; }
}

/**
 * Probe Ashby job board — used by OpenAI, Perplexity, Character.AI, Midjourney, etc.
 */
async function probeAshby(slug) {
    try {
        const r = await fetch('https://api.ashbyhq.com/posting-api/job-board/' + slug, {
            headers: { 'User-Agent': 'JobHunterPro/1.0' },
            signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return null;
        const d = await r.json();
        return d.jobs?.length ? d.jobs : null;
    } catch { return null; }
}

function processAshby(ashbyJobs, company, filterSenior) {
    const out = [];
    for (const j of ashbyJobs) {
        const title = j.title || '';
        if (!isNewGrad(title)) continue;
        if (filterSenior && isSeniorRole(title)) continue;
        const url = j.jobUrl || `https://jobs.ashbyhq.com/${company.slug}/${j.id}`;
        out.push({
            id: makeJobId(url), title, company: company.name,
            location: j.location || 'US', url,
            source: 'ai-companies', category: classifyCategory(title, company.category),
            salary: null, description: j.descriptionPlain || null,
            posted_at: j.publishedAt ? new Date(j.publishedAt).toISOString() : new Date().toISOString(),
        });
    }
    return out;
}

function slugVariants(name) {
    const n = name.toLowerCase().replace(/\s*ai$/i, '').replace(/[()]/g, '');
    return [...new Set([
        n.replace(/[^a-z0-9]/g, ''),
        n.replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''),
        n.split(/\s+/)[0],
        n.replace(/[^a-z0-9]+/g, ''),
    ].filter(s => s.length > 2))];
}

function processGreenhouse(ghJobs, company, filterSenior) {
    const out = [];
    for (const j of ghJobs) {
        const title = j.title || '';
        if (!isNewGrad(title)) continue;
        if (filterSenior && isSeniorRole(title)) continue;
        const url = j.absolute_url || `https://boards.greenhouse.io/${company.slug}/jobs/${j.id}`;
        out.push({
            id: makeJobId(url), title, company: company.name,
            location: j.location?.name || 'US', url,
            source: 'ai-companies', category: classifyCategory(title, company.category),
            salary: null, description: j.content ? j.content.replace(/<[^>]*>/g, '') : null,
            posted_at: j.updated_at ? new Date(j.updated_at).toISOString() : new Date().toISOString(),
        });
    }
    return out;
}

function processLever(postings, company, filterSenior) {
    const out = [];
    for (const p of postings) {
        const title = p.text || '';
        if (!isNewGrad(title)) continue;
        if (filterSenior && isSeniorRole(title)) continue;
        const url = p.hostedUrl || `https://jobs.lever.co/${company.slug}/${p.id}`;
        out.push({
            id: makeJobId(url), title, company: company.name,
            location: p.categories?.location || 'US', url,
            source: 'ai-companies', category: classifyCategory(title, company.category),
            salary: null, description: p.descriptionPlain || null,
            posted_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
        });
    }
    return out;
}

export async function scrapeAICompanies(filterSenior = true) {
    console.log(`\n🤖 AI Companies: probing ${aiCompanies.length} companies...`);

    const allJobs = [];
    let hits = 0;

    // Process in batches of 15 concurrent API probes
    for (let i = 0; i < aiCompanies.length; i += 15) {
        const batch = aiCompanies.slice(i, i + 15);

        const results = await Promise.allSettled(batch.map(async (co) => {
            const slugs = slugVariants(co.name);
            if (co.slug) slugs.unshift(co.slug);

            for (const slug of slugs) {
                const gh = await probeGreenhouse(slug);
                if (gh) return { co, jobs: processGreenhouse(gh, co, filterSenior), via: 'greenhouse' };
                const lv = await probeLever(slug);
                if (lv) return { co, jobs: processLever(lv, co, filterSenior), via: 'lever' };
                const ab = await probeAshby(slug);
                if (ab) return { co, jobs: processAshby(ab, co, filterSenior), via: 'ashby' };
            }
            return { co, jobs: [], via: 'none' };
        }));

        for (const r of results) {
            if (r.status === 'fulfilled' && r.value.jobs.length > 0) {
                allJobs.push(...r.value.jobs);
                hits++;
                console.log(`   ✅ ${r.value.co.name}: ${r.value.jobs.length} jobs via ${r.value.via}`);
            }
        }

        await sleep(200);
    }

    console.log(`✅ AI Companies done: ${allJobs.length} new-grad jobs from ${hits}/${aiCompanies.length} companies`);
    return allJobs;
}
