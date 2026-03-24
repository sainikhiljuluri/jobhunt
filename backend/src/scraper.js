/**
 * Main scraper orchestrator
 * Runs all scrapers, deduplicates, and saves to DB
 */

let chromium;
try { ({ chromium } = await import('playwright')); } catch { chromium = null; }
import { scrapeLinkedIn } from './scrapers/linkedin.js';
import { scrapeIndeed } from './scrapers/indeed.js';
import { scrapeGreenhouse } from './scrapers/greenhouse.js';
import { scrapeLever } from './scrapers/lever.js';
import { scrapeWorkday } from './scrapers/workday.js';
import { scrapeDirectCareerPages } from './scrapers/direct.js';
import { scrapeSimplifyJobs } from './scrapers/simplifyjobs.js';
import { scrapeAdzuna } from './scrapers/adzuna.js';
import { scrapeCareerPages } from './scrapers/career-pages.js';
import { scrapeAICompanies } from './scrapers/ai-companies.js';
import { insertJob, startScrapeRun, finishScrapeRun, getAllSettings } from './db.js';
import { notifyDreamCompanyJobs } from './notifier.js';


export async function runScraper() {
    const settings = getAllSettings();
    const filterSenior = settings.filter_exclude_senior !== 'false';

    console.log('\n🚀 Job Hunter Pro — Starting scrape run...');
    console.log(`⏰ ${new Date().toLocaleString()}`);
    console.log(`🔍 Filter senior roles: ${filterSenior}`);

    const runInfo = startScrapeRun.run();
    const runId = runInfo.lastInsertRowid;

    let totalFound = 0;
    let totalNew = 0;
    const errors = [];
    const allNewJobs = [];

    // ── Fast API scrapers (finish in seconds) ──────────────────────────────────
    const fastScrapers = [
        { name: 'Greenhouse', fn: () => scrapeGreenhouse(filterSenior) },
        { name: 'Lever', fn: () => scrapeLever(filterSenior) },
        { name: 'Workday', fn: () => scrapeWorkday(filterSenior) },
        { name: 'Direct Career Pages', fn: () => scrapeDirectCareerPages(filterSenior) },
        { name: 'SimplifyJobs', fn: () => scrapeSimplifyJobs(filterSenior) },
        { name: 'Adzuna', fn: () => scrapeAdzuna(filterSenior) },
    ];

    const fastResults = await Promise.allSettled(fastScrapers.map(s => s.fn()));
    for (let i = 0; i < fastResults.length; i++) {
        const result = fastResults[i];
        if (result.status === 'fulfilled') {
            const { newCount, inserted } = saveJobs(result.value);
            totalFound += result.value.length;
            totalNew += newCount;
            allNewJobs.push(...inserted);
            console.log(`📦 ${fastScrapers[i].name}: ${result.value.length} found, ${newCount} new`);
        } else {
            const msg = `${fastScrapers[i].name}: ${result.reason?.message}`;
            errors.push(msg);
            console.error(`❌ ${msg}`);
        }
    }

    // AI Companies probe disabled — SimplifyJobs already covers these companies.
    // The 236-company API probe added minimal extra jobs but took 10+ minutes.
    // Re-enable when we add Ashby API scraping (many AI cos use Ashby).

    // ── Browser-based scrapers (LinkedIn, Indeed) ─────────────────────────────
    if (process.env.SKIP_BROWSER_SCRAPERS === 'true') {
        console.log('⏭️  Skipping browser scrapers (SKIP_BROWSER_SCRAPERS=true)');
    } else {
        let browser;
        try {
            browser = await chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                ],
            });

            await browser.newContext({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 800 },
                locale: 'en-US',
            });

            const browserScrapers = [
                { name: 'LinkedIn', fn: () => scrapeLinkedIn(browser, filterSenior) },
                { name: 'Indeed', fn: () => scrapeIndeed(browser, filterSenior) },
                { name: 'Career Pages (205 companies)', fn: () => scrapeCareerPages(browser, filterSenior) },
            ];

            for (const scraper of browserScrapers) {
                try {
                    const jobs = await scraper.fn();
                    const { newCount, inserted } = saveJobs(jobs);
                    totalFound += jobs.length;
                    totalNew += newCount;
                    allNewJobs.push(...inserted);
                    console.log(`📦 ${scraper.name}: ${jobs.length} found, ${newCount} new`);
                } catch (err) {
                    const msg = `${scraper.name}: ${err.message}`;
                    errors.push(msg);
                    console.error(`❌ ${msg}`);
                }
            }
        } finally {
            if (browser) await browser.close();
        }
    }

    // ── Finalize ───────────────────────────────────────────────────────────────
    finishScrapeRun.run(totalFound, totalNew, errors.length ? JSON.stringify(errors) : null, runId);

    console.log(`\n✅ Scrape complete! Found: ${totalFound} | New: ${totalNew} | Errors: ${errors.length}`);
    console.log('─'.repeat(60));

    // ── Notify ───────────────────────────────────────────────────────────────
    if (allNewJobs.length > 0) {
        try {
            await notifyDreamCompanyJobs(allNewJobs);
        } catch (err) {
            console.error(`❌ Notification error: ${err.message}`);
        }
    }

    return { totalFound, totalNew, errors, allNewJobs };
}


/**
 * Only keep jobs with relevant tech titles
 */
const ALLOWED_TITLE_KEYWORDS = [
    'software engineer', 'software developer', 'swe',
    'ai engineer', 'ai developer', 'artificial intelligence',
    'data scientist', 'data science',
    'ml engineer', 'machine learning',
    'data analyst', 'data analytics',
    'python developer',
    'full stack', 'fullstack', 'full-stack',
    'frontend engineer', 'front-end engineer', 'front end engineer',
    'backend engineer', 'back-end engineer', 'back end engineer',
    'data engineer', 'analytics engineer',
    'devops', 'cloud engineer', 'site reliability', 'sre',
    'new grad', 'new graduate', 'entry level',
];

function isRelevantTitle(title) {
    const lower = title.toLowerCase();
    return ALLOWED_TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Insert jobs into DB, returns count + list of actually-new (non-duplicate) jobs
 */
function saveJobs(jobs) {
    let newCount = 0;
    let filtered = 0;
    const inserted = [];
    for (const job of jobs) {
        // Only save jobs with relevant tech titles
        if (!isRelevantTitle(job.title)) { filtered++; continue; }
        try {
            const result = insertJob.run(job);
            if (result.changes > 0) {
                newCount++;
                inserted.push(job);
            }
        } catch (err) {
            if (!err.message.includes('UNIQUE')) {
                console.error(`DB insert error: ${err.message}`);
            }
        }
    }
    if (filtered > 0) console.log(`   🔍 Filtered out ${filtered} irrelevant titles`);
    return { newCount, inserted };
}
