/**
 * Job URL Health Checker
 * Periodically checks if job URLs are still live.
 * Marks dead URLs (404, 410, unreachable) as "closed".
 */

import { getAllSettings, getActiveJobUrls, markJobClosed } from './db.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Check a batch of job URLs and mark dead ones as closed
 */
export async function checkJobUrls() {
    const settings = await getAllSettings();
    if (settings.job_checker_enabled === 'false') return;

    const jobs = await getActiveJobUrls();
    if (jobs.length === 0) return;

    console.log(`\n🔍 Job Checker: checking ${jobs.length} job URLs...`);

    let closed = 0;
    let checked = 0;
    let errors = 0;

    // Process in batches of 5 concurrent requests
    const BATCH_SIZE = 5;
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const batch = jobs.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
            batch.map(async (job) => {
                try {
                    const resp = await fetch(job.url, {
                        method: 'HEAD',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; JobHunterPro/1.0)',
                        },
                        signal: AbortSignal.timeout(8000),
                        redirect: 'follow',
                    });

                    // 404, 410 Gone, or 403 (many ATS return 403 for closed jobs)
                    if (resp.status === 404 || resp.status === 410) {
                        return { job, dead: true };
                    }
                    return { job, dead: false };
                } catch (err) {
                    // Network error / timeout — don't mark as closed (could be temporary)
                    return { job, dead: false, error: err.message };
                }
            })
        );

        for (const result of results) {
            if (result.status === 'fulfilled') {
                checked++;
                if (result.value.dead) {
                    await markJobClosed(result.value.job.id);
                    closed++;
                    console.log(`   ❌ Closed: ${result.value.job.title} @ ${result.value.job.company}`);
                }
                if (result.value.error) errors++;
            }
        }

        // Rate limit between batches
        await sleep(500);
    }

    console.log(`✅ Job Checker done: ${checked} checked, ${closed} closed, ${errors} errors`);
    return { checked, closed, errors };
}
