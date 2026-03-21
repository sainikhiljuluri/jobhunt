/**
 * Mega Career Pages Scraper
 * Scrapes 205 companies from the career portal list.
 *
 * Strategy (per company):
 * 1. Try Greenhouse API (many companies use it behind custom domains)
 * 2. Try Lever API
 * 3. Fall back: Playwright visits the career page and extracts job links
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeJobId, isSeniorRole, classifyCategory, sleep } from '../utils/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const companiesData = JSON.parse(readFileSync(join(__dirname, '../data/companies.json'), 'utf-8'));

const NEW_GRAD_KEYWORDS = [
    'new grad', 'new graduate', 'entry level', 'entry-level',
    'junior', '2025', '2026', 'university', 'campus',
    'associate', 'early career', 'graduate', 'recent grad',
];

function isNewGradRole(title) {
    const lower = title.toLowerCase();
    return NEW_GRAD_KEYWORDS.some(kw => lower.includes(kw));
}

// Companies already covered by existing scrapers — skip to avoid duplicates
const ALREADY_SCRAPED = new Set([
    'openai', 'anthropic', 'stripe', 'figma', 'notion', 'databricks',
    'snowflake', 'airbnb', 'lyft', 'doordash', 'robinhood', 'coinbase',
    'netflix', 'discord', 'reddit', 'vercel', 'duolingo',
    'cloudflare', 'datadog', 'mongodb', 'twilio', 'hashicorp', 'palantir',
    'spacex', 'dropbox', 'asana', 'zendesk', 'airtable', 'plaid',
    'gusto', 'brex', 'scale', 'ramp',
]);

function isAlreadyScraped(companyName) {
    const lower = companyName.toLowerCase();
    return [...ALREADY_SCRAPED].some(s => lower.includes(s));
}

/**
 * Try fetching jobs from Greenhouse API using company slug
 */
async function tryGreenhouse(slug) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    const resp = await fetch(url, {
        headers: { 'User-Agent': 'JobHunterPro/1.0' },
        signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.jobs || data.jobs.length === 0) return null;
    return data.jobs;
}

/**
 * Try fetching jobs from Lever API using company slug
 */
async function tryLever(slug) {
    const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
    const resp = await fetch(url, {
        headers: { 'User-Agent': 'JobHunterPro/1.0' },
        signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data;
}

/**
 * Generate possible ATS slugs from company name
 */
function generateSlugs(company) {
    const name = company.name.toLowerCase();
    const slugs = [
        name.replace(/[^a-z0-9]+/g, ''),           // "paloaltonetworks"
        name.replace(/[^a-z0-9]+/g, '-'),           // "palo-alto-networks"
        name.replace(/[^a-z0-9]+/g, '').slice(0,20),
        name.split(/\s+/)[0],                        // first word: "palo"
    ];
    // Try extracting from careers URL domain
    try {
        const hostname = new URL(company.careersUrl).hostname;
        const parts = hostname.replace('www.', '').replace('careers.', '').replace('jobs.', '').split('.')[0];
        slugs.push(parts);
    } catch (_) {}
    return [...new Set(slugs.filter(s => s.length > 2))];
}

/**
 * Scrape a single company via Playwright (generic fallback)
 */
async function scrapeWithPlaywright(browser, company, filterSenior) {
    const jobs = [];
    const page = await browser.newPage();

    try {
        await page.goto(company.careersUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2000);

        // Try to find and use a search box
        const searchSelectors = [
            'input[type="search"]', 'input[type="text"][placeholder*="search"]',
            'input[placeholder*="Search"]', 'input[name="q"]', 'input[name="query"]',
            'input[name="search"]', 'input[id*="search"]', 'input[class*="search"]',
        ];

        let searched = false;
        for (const sel of searchSelectors) {
            try {
                const input = await page.$(sel);
                if (input) {
                    await input.fill('new grad');
                    await input.press('Enter');
                    await sleep(3000);
                    searched = true;
                    break;
                }
            } catch (_) {}
        }

        // Extract all links that look like job postings
        const links = await page.evaluate(() => {
            const allLinks = Array.from(document.querySelectorAll('a[href]'));
            return allLinks
                .filter(a => {
                    const href = a.href || '';
                    const text = (a.textContent || '').trim();
                    // Links that look like job postings
                    return text.length > 5 && text.length < 200 &&
                        (href.includes('/job') || href.includes('/position') ||
                         href.includes('/opening') || href.includes('/career') ||
                         href.includes('/apply') || href.includes('/requisition') ||
                         href.includes('jobId=') || href.includes('job_id='));
                })
                .map(a => ({
                    title: (a.textContent || '').trim().replace(/\s+/g, ' '),
                    url: a.href,
                }))
                .filter(j => j.title && j.url)
                .slice(0, 50);
        });

        for (const link of links) {
            if (!isNewGradRole(link.title)) continue;
            if (filterSenior && isSeniorRole(link.title)) continue;

            jobs.push({
                id: makeJobId(link.url),
                title: link.title,
                company: company.name,
                location: company.state || 'US',
                url: link.url,
                source: 'career-page',
                category: classifyCategory(link.title, company.roles || ''),
                salary: null,
                description: null,
                posted_at: new Date().toISOString(),
            });
        }
    } catch (err) {
        // Silently skip pages that fail to load
    } finally {
        await page.close();
    }

    return jobs;
}

/**
 * Main scraper — processes all 205 companies
 */
export async function scrapeCareerPages(browser, filterSenior = true) {
    console.log(`\n🏢 Career Pages: processing ${companiesData.length} companies...`);

    const allJobs = [];
    let apiHits = 0;
    let browserHits = 0;
    let skipped = 0;

    // Phase 1: Try Greenhouse + Lever APIs (fast, no browser needed)
    const apiCompanies = companiesData.filter(c => !isAlreadyScraped(c.name));
    console.log(`   Skipping ${companiesData.length - apiCompanies.length} already-scraped companies`);

    // Process in batches of 10 for API probing
    for (let i = 0; i < apiCompanies.length; i += 10) {
        const batch = apiCompanies.slice(i, i + 10);

        const results = await Promise.allSettled(batch.map(async (company) => {
            const slugs = generateSlugs(company);
            const jobs = [];

            // Try Greenhouse
            for (const slug of slugs) {
                try {
                    const ghJobs = await tryGreenhouse(slug);
                    if (ghJobs) {
                        for (const job of ghJobs) {
                            const title = job.title || '';
                            if (!isNewGradRole(title)) continue;
                            if (filterSenior && isSeniorRole(title)) continue;

                            const jobUrl = job.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${job.id}`;
                            jobs.push({
                                id: makeJobId(jobUrl),
                                title,
                                company: company.name,
                                location: job.location?.name || company.state || 'US',
                                url: jobUrl,
                                source: 'career-page',
                                category: classifyCategory(title, company.roles || ''),
                                salary: null,
                                description: job.content ? job.content.replace(/<[^>]*>/g, '') : null,
                                posted_at: job.updated_at ? new Date(job.updated_at).toISOString() : new Date().toISOString(),
                            });
                        }
                        if (jobs.length > 0) return { company: company.name, jobs, method: 'greenhouse' };
                        return { company: company.name, jobs: [], method: 'greenhouse-no-match' };
                    }
                } catch (_) {}
            }

            // Try Lever
            for (const slug of slugs) {
                try {
                    const leverJobs = await tryLever(slug);
                    if (leverJobs) {
                        for (const posting of leverJobs) {
                            const title = posting.text || '';
                            if (!isNewGradRole(title)) continue;
                            if (filterSenior && isSeniorRole(title)) continue;

                            const jobUrl = posting.hostedUrl || `https://jobs.lever.co/${slug}/${posting.id}`;
                            jobs.push({
                                id: makeJobId(jobUrl),
                                title,
                                company: company.name,
                                location: posting.categories?.location || company.state || 'US',
                                url: jobUrl,
                                source: 'career-page',
                                category: classifyCategory(title, company.roles || ''),
                                salary: null,
                                description: posting.descriptionPlain || null,
                                posted_at: posting.createdAt ? new Date(posting.createdAt).toISOString() : new Date().toISOString(),
                            });
                        }
                        if (jobs.length > 0) return { company: company.name, jobs, method: 'lever' };
                        return { company: company.name, jobs: [], method: 'lever-no-match' };
                    }
                } catch (_) {}
            }

            return { company: company.name, jobs: [], method: 'no-api' };
        }));

        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.jobs.length > 0) {
                allJobs.push(...result.value.jobs);
                apiHits++;
                console.log(`   ✅ ${result.value.company}: ${result.value.jobs.length} jobs via ${result.value.method}`);
            }
        }

        await sleep(200);
    }

    // Phase 2: Playwright fallback for companies where API probing failed
    if (browser) {
        const noApiCompanies = apiCompanies.filter(c => {
            return !allJobs.some(j => j.company === c.name);
        });

        // Only process first 50 via browser to avoid timeouts on free tier
        const browserCompanies = noApiCompanies.slice(0, 50);
        console.log(`   🌐 Trying Playwright for ${browserCompanies.length}/${noApiCompanies.length} remaining companies...`);

        for (const company of browserCompanies) {
            try {
                const jobs = await scrapeWithPlaywright(browser, company, filterSenior);
                if (jobs.length > 0) {
                    allJobs.push(...jobs);
                    browserHits++;
                    console.log(`   ✅ ${company.name}: ${jobs.length} jobs via browser`);
                }
            } catch (_) {}
            await sleep(500);
        }
    }

    console.log(`✅ Career Pages done: ${allJobs.length} jobs from ${apiHits} API + ${browserHits} browser hits`);
    return allJobs;
}
