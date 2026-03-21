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
const dataPath = join(__dirname, '../data/ai_companies.json');
let aiCompanies = [];
try {
    aiCompanies = JSON.parse(readFileSync(dataPath, 'utf-8'));
    console.log(`📂 AI Companies: loaded ${aiCompanies.length} companies from ${dataPath}`);
} catch (err) {
    console.warn(`⚠️  ai_companies.json not found at ${dataPath}: ${err.message}`);
}

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
            signal: AbortSignal.timeout(3000),
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
            signal: AbortSignal.timeout(3000),
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
            signal: AbortSignal.timeout(3000),
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
    const n = name.toLowerCase().replace(/\s*ai$/i, '').replace(/[()]/g, '').trim();
    return [...new Set([
        n.replace(/[^a-z0-9]/g, ''),
        n.replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''),
    ].filter(s => s.length > 2))].slice(0, 2);
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

    // Process in batches of 30 concurrent API probes
    for (let i = 0; i < aiCompanies.length; i += 30) {
        const batch = aiCompanies.slice(i, i + 30);

        const results = await Promise.allSettled(batch.map(async (co) => {
            const slugs = slugVariants(co.name);
            if (co.slug) slugs.unshift(co.slug);

            // Probe all APIs in parallel for speed
            const slug = slugs[0];
            const [gh, lv, ab] = await Promise.all([
                probeGreenhouse(slug),
                probeLever(slug),
                probeAshby(slug),
            ]);
            if (gh) return { co, jobs: processGreenhouse(gh, co, filterSenior), via: 'greenhouse' };
            if (lv) return { co, jobs: processLever(lv, co, filterSenior), via: 'lever' };
            if (ab) return { co, jobs: processAshby(ab, co, filterSenior), via: 'ashby' };

            // Try second slug if first didn't match
            if (slugs[1]) {
                const [gh2, lv2, ab2] = await Promise.all([
                    probeGreenhouse(slugs[1]),
                    probeLever(slugs[1]),
                    probeAshby(slugs[1]),
                ]);
                if (gh2) return { co, jobs: processGreenhouse(gh2, co, filterSenior), via: 'greenhouse' };
                if (lv2) return { co, jobs: processLever(lv2, co, filterSenior), via: 'lever' };
                if (ab2) return { co, jobs: processAshby(ab2, co, filterSenior), via: 'ashby' };
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
