# Design: Slack Alerts + Smarter Scraping

**Date:** 2026-03-20
**Status:** Approved

## Features

1. **Slack instant alerts** for dream company jobs via incoming webhook
2. **Slack batched digest** every 6h summarizing new jobs
3. **30-min scrape cycle** (was 4h)
4. **Full job descriptions** (remove 500-char truncation)
5. **Closed job detection** — HEAD-check URLs, mark dead ones as closed

## Approach

Integrated into existing backend (Approach A). No new services or dependencies.

## New Files
- `backend/src/notifier.js` — Slack webhook notifications
- `backend/src/job-checker.js` — URL health checker for closed jobs

## Modified Files
- `backend/src/scraper.js` — call notifier after save, remove description truncation
- `backend/src/scheduler.js` — 30min cron, digest cron, job checker cron
- `backend/src/db.js` — new settings, closed_at column, new prepared statements
- `backend/src/server.js` — add 'closed' to valid statuses
- All 8 scraper files — remove `.slice(0, 500)` on descriptions
- `frontend/src/app/page.tsx` — closed status tab + badge
- `frontend/src/app/settings/page.tsx` — notifications settings section
- `frontend/src/app/globals.css` — closed job styles
- `frontend/src/lib/api.ts` — add 'closed' to Job type

## New Settings
- `slack_webhook_url` — Slack incoming webhook URL
- `slack_enabled` — toggle (default false)
- `dream_companies` — comma-separated names for instant alerts
- `digest_interval_hours` — default 6
- `scrape_interval_minutes` — default 30
