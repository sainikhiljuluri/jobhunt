/**
 * Scheduler — orchestrates scraping, digest, and job health checks
 */

import cron from 'node-cron';
import { runScraper } from './scraper.js';
import { sendDigest } from './notifier.js';
import { checkJobUrls } from './job-checker.js';
import { getNewJobsSince, getAllSettings, deleteOldJobs } from './db.js';

let isRunning = false;
let lastDigestTime = new Date().toISOString();

// ── Scraper ──────────────────────────────────────────────────────────────────

export function startScheduler() {
    const settings = getAllSettings();
    const intervalMin = parseInt(settings.scrape_interval_minutes) || 30;

    console.log(`⏰ Scheduler initialized — scraping every ${intervalMin} minutes`);

    // Run immediately on startup
    runScraperSafe();

    // Scrape on configured interval (default: every 30 min)
    cron.schedule(`*/${intervalMin} * * * *`, () => {
        runScraperSafe();
    });

    // Digest cron — runs on its own interval (default: every 6 hours)
    const digestHours = parseInt(settings.digest_interval_hours) || 6;
    cron.schedule(`0 */${digestHours} * * *`, () => {
        runDigestSafe();
    });

    // Job health checker — runs every 12 hours
    cron.schedule('0 */12 * * *', () => {
        runJobCheckerSafe();
    });

    // Cleanup old jobs daily at midnight
    cron.schedule('0 0 * * *', () => {
        const result = deleteOldJobs.run();
        console.log(`🗑️  Cleanup: deleted ${result.changes} jobs older than 3 days`);
    });

    // Run cleanup on startup too
    const startupCleanup = deleteOldJobs.run();
    if (startupCleanup.changes > 0) console.log(`🗑️  Startup cleanup: deleted ${startupCleanup.changes} old jobs`);

    console.log(`📨 Digest scheduled every ${digestHours} hours`);
    console.log(`🔍 Job URL checker scheduled every 12 hours`);
    console.log(`🗑️  Auto-cleanup scheduled daily (jobs > 3 days, except saved/applied)`);
}

async function runScraperSafe() {
    if (isRunning) {
        console.log('⚠️  Scraper already running, skipping this cycle');
        return;
    }
    isRunning = true;
    try {
        await runScraper();
    } catch (err) {
        console.error('💥 Fatal scraper error:', err);
    } finally {
        isRunning = false;
    }
}

// ── Digest ───────────────────────────────────────────────────────────────────

async function runDigestSafe() {
    try {
        const newJobs = getNewJobsSince.all(lastDigestTime);
        if (newJobs.length > 0) {
            await sendDigest(newJobs);
            lastDigestTime = new Date().toISOString();
        } else {
            console.log('📨 Digest: no new jobs since last digest, skipping');
        }
    } catch (err) {
        console.error('💥 Digest error:', err);
    }
}

// ── Job Checker ──────────────────────────────────────────────────────────────

async function runJobCheckerSafe() {
    try {
        await checkJobUrls();
    } catch (err) {
        console.error('💥 Job checker error:', err);
    }
}

export { runScraperSafe as triggerScrape };
