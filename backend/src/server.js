/**
 * Express REST API server
 */

import express from 'express';
import cors from 'cors';
import { initDB } from './db.js';
import { startScheduler, triggerScrape } from './scheduler.js';
import {
    getJobs, updateJobStatus, markAllSeen,
    getStats, getAllSettings, upsertSetting, getLastScrapeRun,
} from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ── Jobs ──────────────────────────────────────────────────────────────────────

app.get('/api/jobs', async (req, res) => {
    try {
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

        const { jobs, total } = await getJobs(params);
        res.json({ jobs, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        console.error('GET /api/jobs error:', err);
        res.status(500).json({ error: 'Failed to fetch jobs' });
    }
});

app.patch('/api/jobs/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const valid = ['new', 'saved', 'applied', 'ignored', 'closed'];
    if (!valid.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });
    }

    try {
        await updateJobStatus(status, id);
        res.json({ ok: true });
    } catch (err) {
        console.error('PATCH /api/jobs/:id/status error:', err);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

app.post('/api/jobs/mark-seen', async (_req, res) => {
    try {
        await markAllSeen();
        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/jobs/mark-seen error:', err);
        res.status(500).json({ error: 'Failed to mark seen' });
    }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', async (_req, res) => {
    try {
        const stats = await getStats();
        const lastRun = await getLastScrapeRun();
        res.json({ ...stats, last_run: lastRun });
    } catch (err) {
        console.error('GET /api/stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ── Scraper Control ───────────────────────────────────────────────────────────

app.post('/api/scrape/run', async (_req, res) => {
    res.json({ ok: true, message: 'Scrape started in background' });
    triggerScrape().catch(console.error);
});

// ── Settings ──────────────────────────────────────────────────────────────────

app.get('/api/settings', async (_req, res) => {
    try {
        const settings = await getAllSettings();
        res.json(settings);
    } catch (err) {
        console.error('GET /api/settings error:', err);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const updates = req.body;
        for (const [key, value] of Object.entries(updates)) {
            await upsertSetting(key, String(value));
        }
        const settings = await getAllSettings();
        res.json({ ok: true, settings });
    } catch (err) {
        console.error('POST /api/settings error:', err);
        res.status(500).json({ error: 'Failed to update settings' });
    }
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
    app.get('*', (req, res) => {
        if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
        const page = path.join(frontendPath, req.path, 'index.html');
        if (fs.existsSync(page)) return res.sendFile(page);
        res.sendFile(path.join(frontendPath, 'index.html'));
    });
    console.log('🌐 Serving frontend from', frontendPath);
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
    await initDB();
    app.listen(PORT, () => {
        console.log(`\n🎯 Job Hunter Pro running at http://localhost:${PORT}`);
        startScheduler();
    });
}

start().catch(err => {
    console.error('💥 Failed to start server:', err);
    process.exit(1);
});
