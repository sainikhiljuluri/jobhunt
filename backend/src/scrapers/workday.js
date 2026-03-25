/**
 * Workday Job Board Scraper
 * Verified API endpoints for each company — correct subdomain, wd instance, and site name.
 * Uses multiple search terms and deduplicates results for maximum coverage.
 */

import { makeJobId, isSeniorRole, sleep, classifyCategory, parsePostedAt } from '../utils/helpers.js';

// ── Verified Workday Tenants ─────────────────────────────────────────────────
// Each entry has been probed and confirmed working.
// Format: subdomain.{wdInstance}.myworkdayjobs.com/wday/cxs/{subdomain}/{siteName}/jobs

const WORKDAY_TENANTS = [
    { company: 'Nvidia',           sub: 'nvidia',       wd: 'wd5',  site: 'NVIDIAExternalCareerSite' },
    { company: 'Salesforce',       sub: 'salesforce',   wd: 'wd12', site: 'External_Career_Site' },
    { company: 'Adobe',            sub: 'adobe',        wd: 'wd5',  site: 'external_experienced' },
    { company: 'Intel',            sub: 'intel',        wd: 'wd1',  site: 'External' },
    { company: 'Cisco',            sub: 'cisco',        wd: 'wd5',  site: 'Cisco_Careers' },
    { company: 'Boeing',           sub: 'boeing',       wd: 'wd1',  site: 'EXTERNAL_CAREERS' },
    { company: 'Walmart',          sub: 'walmart',      wd: 'wd5',  site: 'WalmartExternal' },
    { company: 'Workday',          sub: 'workday',      wd: 'wd5',  site: 'Workday' },
    { company: 'Northrop Grumman', sub: 'ngc',          wd: 'wd1',  site: 'Northrop_Grumman_External_Site' },
    { company: 'Micron',           sub: 'micron',       wd: 'wd1',  site: 'External' },
    { company: 'Dell',             sub: 'dell',         wd: 'wd1',  site: 'External' },
    { company: 'Boston Dynamics',  sub: 'bostondynamics', wd: 'wd1', site: 'Boston_Dynamics' },
];

// Multiple search terms to maximize coverage — companies tag jobs differently
const SEARCH_TERMS = [
    'new grad 2026',
    'new graduate',
    'entry level software engineer',
    'university',
];

const PAGE_SIZE = 20;

async function fetchWorkdayJobs(tenant, searchText) {
    const apiUrl = `https://${tenant.sub}.${tenant.wd}.myworkdayjobs.com/wday/cxs/${tenant.sub}/${tenant.site}/jobs`;

    const allPostings = [];
    let offset = 0;
    let total = Infinity;

    // Paginate through all results (max 100 per search term)
    while (offset < total && offset < 100) {
        const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; JobHunterPro/1.0)',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                appliedFacets: {},
                limit: PAGE_SIZE,
                offset,
                searchText,
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) return [];
        const data = await resp.json();
        total = data.total || 0;
        const postings = data.jobPostings || [];
        if (postings.length === 0) break;
        allPostings.push(...postings);
        offset += PAGE_SIZE;
    }

    return allPostings;
}

export async function scrapeWorkday(filterSenior = true) {
    console.log(`\n🏢 Workday: probing ${WORKDAY_TENANTS.length} verified tenants...`);

    const jobs = [];
    const seenUrls = new Set();

    for (const tenant of WORKDAY_TENANTS) {
        try {
            let tenantTotal = 0;

            // Run all search terms for this tenant
            for (const term of SEARCH_TERMS) {
                const postings = await fetchWorkdayJobs(tenant, term);

                for (const posting of postings) {
                    const title = posting.title || '';
                    if (filterSenior && isSeniorRole(title)) continue;

                    const jobUrl = posting.externalPath
                        ? `https://${tenant.sub}.${tenant.wd}.myworkdayjobs.com${posting.externalPath}`
                        : null;
                    if (!jobUrl) continue;

                    // Deduplicate across search terms
                    if (seenUrls.has(jobUrl)) continue;
                    seenUrls.add(jobUrl);

                    const location = posting.locationsText || 'US';
                    const postedAt = posting.postedOn
                        ? parsePostedAt(posting.postedOn)
                        : new Date().toISOString();

                    jobs.push({
                        id: makeJobId(jobUrl),
                        title,
                        company: tenant.company,
                        location,
                        url: jobUrl,
                        source: 'workday',
                        category: classifyCategory(title),
                        salary: null,
                        description: posting.bulletFields?.join(' | ') || null,
                        posted_at: postedAt,
                    });
                    tenantTotal++;
                }

                await sleep(300);
            }

            if (tenantTotal > 0) {
                console.log(`   ✅ Workday [${tenant.company}]: ${tenantTotal} jobs`);
            }
        } catch (err) {
            console.error(`   ❌ Workday [${tenant.company}]: ${err.message}`);
        }
    }

    console.log(`✅ Workday done: ${jobs.length} total jobs from ${WORKDAY_TENANTS.length} companies`);
    return jobs;
}
