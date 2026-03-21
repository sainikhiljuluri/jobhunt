/**
 * Express REST API server
 */

import express from 'express';
import cors from 'cors';
import { startScheduler, triggerScrape } from './scheduler.js';
import {
    getJobs, countJobs, updateJobStatus, markAllSeen,
    getStats, getAllSettings, upsertSetting, getLastScrapeRun,
} from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

// In production: set ALLOWED_ORIGIN env var to your Vercel URL (e.g. https://job-hunter-pro.vercel.app)
app.use(cors());
app.use(express.json());

// ── Jobs ──────────────────────────────────────────────────────────────────────

app.get('/api/jobs', (req, res) => {
    const { status, category, source, search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const params = {
        status: status || null,
        category: category || null,
        source: source || null,
        search: search ? `%${search}%` : null,
        limit: parseInt(limit),
        offset,
    };

    const jobs = getJobs.all(params);
    const { total } = countJobs.get(params);

    res.json({ jobs, total, page: parseInt(page), limit: parseInt(limit) });
});

app.patch('/api/jobs/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const valid = ['new', 'saved', 'applied', 'ignored', 'closed'];
    if (!valid.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });
    }

    updateJobStatus.run(status, id);
    res.json({ ok: true });
});

app.post('/api/jobs/mark-seen', (_req, res) => {
    markAllSeen.run();
    res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', (_req, res) => {
    const stats = getStats.get();
    const lastRun = getLastScrapeRun.get();
    res.json({ ...stats, last_run: lastRun });
});

// ── Scraper Control ───────────────────────────────────────────────────────────

app.post('/api/scrape/run', async (_req, res) => {
    res.json({ ok: true, message: 'Scrape started in background' });
    // Don't await — let it run in background
    triggerScrape().catch(console.error);
});

// ── Settings ──────────────────────────────────────────────────────────────────

app.get('/api/settings', (_req, res) => {
    res.json(getAllSettings());
});

app.post('/api/settings', (req, res) => {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
        upsertSetting.run(key, String(value));
    }
    res.json({ ok: true, settings: getAllSettings() });
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

// ── Serve Frontend (production) ──────────────────────────────────────────────

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendPath = path.join(__dirname, '../../frontend/out');

import fs from 'fs';
if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    // Serve index.html for all non-API routes (SPA fallback)
    app.get('*', (req, res) => {
        if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
        const page = path.join(frontendPath, req.path, 'index.html');
        if (fs.existsSync(page)) return res.sendFile(page);
        res.sendFile(path.join(frontendPath, 'index.html'));
    });
    console.log('🌐 Serving frontend from', frontendPath);
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n🎯 Job Hunter Pro running at http://localhost:${PORT}`);
    startScheduler();
});
