/**
 * Slack Notification System
 * - Instant alerts for dream company jobs
 * - Batched digest of all new jobs
 */

import { getAllSettings } from './db.js';

/**
 * Send a Slack message via incoming webhook
 */
async function sendSlack(webhookUrl, payload) {
    const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Slack webhook failed: ${resp.status} — ${text}`);
    }
}

/**
 * Send instant alerts for dream company jobs
 * Called after each scrape with the list of newly inserted jobs
 */
export async function notifyDreamCompanyJobs(newJobs) {
    const settings = getAllSettings();
    if (settings.slack_enabled !== 'true' || !settings.slack_webhook_url) return;

    const dreamCompanies = (settings.dream_companies || '')
        .split(',')
        .map(c => c.trim().toLowerCase())
        .filter(Boolean);

    if (dreamCompanies.length === 0) return;

    const dreamJobs = newJobs.filter(job =>
        dreamCompanies.some(dc => job.company.toLowerCase().includes(dc))
    );

    if (dreamJobs.length === 0) return;

    const frontendUrl = settings.frontend_url || 'http://localhost:3000';

    for (const job of dreamJobs.slice(0, 10)) {
        const categoryLabel = {
            ai: 'AI Engineer', ml: 'ML Engineer', swe: 'Software Engineer',
            fullstack: 'Full Stack', 'data-science': 'Data Science',
            'data-engineer': 'Data Engineer', 'data-analyst': 'Data Analyst',
            devops: 'DevOps/Cloud',
        }[job.category] || job.category;

        const payload = {
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `🚨 *Dream Job Alert!*\n\n*${job.title}* — ${job.company}\n📍 ${job.location || 'Location not specified'} | 🏷️ ${categoryLabel}${job.salary ? ` | 💰 ${job.salary}` : ''}`,
                    },
                },
                {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: { type: 'plain_text', text: '🔗 Apply Now' },
                            url: job.url,
                            style: 'primary',
                        },
                        {
                            type: 'button',
                            text: { type: 'plain_text', text: '📋 View Dashboard' },
                            url: frontendUrl,
                        },
                    ],
                },
            ],
        };

        try {
            await sendSlack(settings.slack_webhook_url, payload);
            console.log(`📨 Slack alert sent: ${job.title} @ ${job.company}`);
        } catch (err) {
            console.error(`❌ Slack alert failed: ${err.message}`);
        }
    }

    if (dreamJobs.length > 10) {
        console.log(`📨 Sent 10/${dreamJobs.length} dream job alerts (capped to avoid spam)`);
    }
}

/**
 * Send a batched digest of all new jobs since last digest
 */
export async function sendDigest(newJobsSinceLastDigest) {
    const settings = getAllSettings();
    if (settings.slack_enabled !== 'true' || !settings.slack_webhook_url) return;
    if (newJobsSinceLastDigest.length === 0) return;

    const frontendUrl = settings.frontend_url || 'http://localhost:3000';

    // Count by category
    const counts = {};
    for (const job of newJobsSinceLastDigest) {
        counts[job.category] = (counts[job.category] || 0) + 1;
    }

    const categoryLabels = {
        ai: 'AI Engineer', ml: 'ML Engineer', swe: 'SWE',
        fullstack: 'Full Stack', 'data-science': 'Data Science',
        'data-engineer': 'Data Eng', 'data-analyst': 'Data Analyst',
        devops: 'DevOps',
    };

    const breakdown = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, n]) => `• ${n} ${categoryLabels[cat] || cat}`)
        .join('\n');

    // Count by source
    const sourceCounts = {};
    for (const job of newJobsSinceLastDigest) {
        sourceCounts[job.source] = (sourceCounts[job.source] || 0) + 1;
    }
    const sourceBreakdown = Object.entries(sourceCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([src, n]) => `${src}: ${n}`)
        .join(' | ');

    const payload = {
        blocks: [
            {
                type: 'header',
                text: { type: 'plain_text', text: `📊 Job Hunter Pro — ${newJobsSinceLastDigest.length} New Jobs` },
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*By category:*\n${breakdown}\n\n*By source:* ${sourceBreakdown}`,
                },
            },
            {
                type: 'actions',
                elements: [
                    {
                        type: 'button',
                        text: { type: 'plain_text', text: '👉 View Dashboard' },
                        url: frontendUrl,
                        style: 'primary',
                    },
                ],
            },
        ],
    };

    try {
        await sendSlack(settings.slack_webhook_url, payload);
        console.log(`📨 Slack digest sent: ${newJobsSinceLastDigest.length} jobs`);
    } catch (err) {
        console.error(`❌ Slack digest failed: ${err.message}`);
    }
}
