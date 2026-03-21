# CLAUDE.md - Job Hunter Pro

## Project Overview

**Job Hunter Pro** is a full-stack job aggregation dashboard for 2026 new-grad candidates. It automatically scrapes job listings from 8+ sources every 4 hours and presents them in a polished dark-themed dashboard where users can search, filter, save, apply, and hide jobs.

**Target audience:** New grad / entry-level candidates seeking AI, SWE, Data, ML, DevOps roles.

---

## Architecture

```
jobhunt/
  backend/              # Node.js + Express REST API
    src/
      server.js         # Express app, routes, CORS, entry point (port 4000)
      db.js             # SQLite via better-sqlite3, schema, prepared statements
      scraper.js        # Orchestrator: runs all scrapers, saves to DB
      scheduler.js      # node-cron: triggers scraper every 4h with mutex guard
      migrate-categories.js  # One-time migration to re-classify job categories
      utils/
        helpers.js      # Shared: makeJobId, parsePostedAt, isSeniorRole, classifyCategory, retry, sleep, shuffle
      scrapers/
        greenhouse.js   # Greenhouse public JSON API (27 companies)
        lever.js        # Lever public JSON API (30 companies)
        workday.js      # Workday REST API POST (20 FAANG companies)
        simplifyjobs.js # Community GitHub JSON feed (SimplifyJobs repo)
        adzuna.js       # Adzuna API (requires ADZUNA_APP_ID + ADZUNA_APP_KEY)
        direct.js       # Direct company career pages (Greenhouse-based feeds)
        linkedin.js     # Playwright browser scraping (3 search categories)
        indeed.js       # Playwright browser scraping (3 search categories)
  frontend/             # Next.js 15 + React 19 + Tailwind CSS 4
    src/
      app/
        page.tsx        # Main dashboard (stats, filters, job cards, pagination)
        layout.tsx      # Root layout with metadata
        globals.css     # 940-line custom dark-theme CSS
        settings/
          page.tsx      # Settings page (keywords, schedule, filters)
      lib/
        api.ts          # Typed API client (all fetch calls + TS interfaces)
```

---

## Tech Stack

| Layer        | Technology                                      |
|-------------|------------------------------------------------|
| Backend     | Node.js (ES modules) + Express 4.18            |
| Database    | SQLite via better-sqlite3 (WAL mode)            |
| Scraping    | Playwright (LinkedIn, Indeed) + native fetch (APIs) |
| Scheduling  | node-cron (every 4 hours)                       |
| Frontend    | Next.js 15.2 + React 19 + TypeScript 5          |
| Styling     | Tailwind CSS 4.2 + custom CSS variables         |
| Deployment  | Backend: Railway (Docker) / Frontend: Vercel    |
| Fonts       | Inter + Space Grotesk (Google Fonts)            |

---

## Data Flow

```
1. Scheduler (node-cron) triggers runScraper() every 4h or on-demand via POST /api/scrape/run
2. API-based scrapers (Greenhouse, Lever, Workday, SimplifyJobs, Adzuna, Direct) run in PARALLEL via Promise.allSettled
3. Browser-based scrapers (LinkedIn, Indeed) run SEQUENTIALLY sharing one Chromium instance
4. Each scraper returns Job[] arrays with normalized fields
5. Jobs deduplicated by URL -> SHA-256 hash (first 16 chars) used as primary key
6. INSERT OR IGNORE prevents duplicates in SQLite
7. scrape_runs table logs each run's stats (found/new/errors)
8. Frontend polls GET /api/stats every 30 seconds
9. Dashboard fetches paginated jobs with filters (status/category/source/search)
10. Users interact: Save, Apply, Hide, Search, Filter, Scrape Now
```

---

## Database Schema

### `jobs` table
| Column      | Type    | Notes                                    |
|------------|---------|------------------------------------------|
| id         | TEXT PK | SHA-256(url).slice(0,16)                 |
| title      | TEXT    | NOT NULL                                 |
| company    | TEXT    | NOT NULL                                 |
| location   | TEXT    | nullable                                 |
| url        | TEXT    | NOT NULL UNIQUE                          |
| source     | TEXT    | NOT NULL (linkedin/indeed/greenhouse/lever/workday/direct/simplifyjobs/adzuna) |
| category   | TEXT    | NOT NULL (swe/fullstack/ai/ml/data-science/data-engineer/data-analyst/devops) |
| salary     | TEXT    | nullable                                 |
| description| TEXT    | nullable (first 500 chars)               |
| posted_at  | TEXT    | ISO datetime                             |
| scraped_at | TEXT    | DEFAULT datetime('now')                  |
| status     | TEXT    | DEFAULT 'new' (new/saved/applied/ignored)|
| is_new     | INTEGER | DEFAULT 1 (boolean flag)                 |

**Indexes:** status, category, source, scraped_at, is_new

### `scrape_runs` table
| Column      | Type    | Notes                  |
|------------|---------|------------------------|
| id         | INTEGER | AUTOINCREMENT PK       |
| started_at | TEXT    | DEFAULT datetime('now')|
| finished_at| TEXT    | nullable               |
| jobs_found | INTEGER | DEFAULT 0              |
| jobs_new   | INTEGER | DEFAULT 0              |
| errors     | TEXT    | JSON array or null     |

### `settings` table
Key-value store: `key TEXT PK`, `value TEXT NOT NULL`

Default settings: `keywords_ai`, `keywords_swe`, `keywords_data`, `scrape_interval_hours` (4), `filter_exclude_senior` (true), `notification_enabled` (true)

---

## API Endpoints

| Method | Path                 | Description                    |
|--------|---------------------|-------------------------------|
| GET    | /api/jobs           | List jobs (paginated, filterable by status/category/source/search) |
| PATCH  | /api/jobs/:id/status| Update job status (new/saved/applied/ignored) |
| POST   | /api/jobs/mark-seen | Mark all jobs as seen (is_new = 0) |
| GET    | /api/stats          | Dashboard statistics + last scrape run |
| POST   | /api/scrape/run     | Trigger on-demand scrape (runs in background) |
| GET    | /api/settings       | Get all settings                |
| POST   | /api/settings       | Update settings (key-value pairs) |
| GET    | /api/health         | Health check (used by Railway)  |

---

## Scraper Details

### API-based (no browser, run in parallel)
- **Greenhouse** (`greenhouse.js`): Fetches `boards-api.greenhouse.io/v1/boards/{company}/jobs`. 27 companies including OpenAI, Anthropic, Stripe, Figma, Databricks. Filters for new-grad keywords.
- **Lever** (`lever.js`): Fetches `api.lever.co/v0/postings/{company}`. 30 companies including Netflix, Discord, Coinbase, Vercel. Filters for new-grad + early-career keywords.
- **Workday** (`workday.js`): POST to `{subdomain}.wd1.myworkdayjobs.com` search API. 20 companies including Google, Meta, Apple, Microsoft, Amazon, Nvidia. Searches "new grad 2026".
- **SimplifyJobs** (`simplifyjobs.js`): Fetches community-maintained JSON from GitHub (`SimplifyJobs/New-Grad-Positions`). Filters: active, visible, posted within 90 days.
- **Adzuna** (`adzuna.js`): Optional (requires `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`). Free tier: 1000 calls/month. Searches US jobs, last 3 days.
- **Direct** (`direct.js`): Additional Greenhouse feeds for Cloudflare, Datadog, MongoDB, Twilio, HashiCorp, Palantir, SpaceX. Tesla/Apple feeds defined but not yet implemented.

### Browser-based (Playwright, run sequentially)
- **LinkedIn** (`linkedin.js`): Scrapes public search results. Uses realistic User-Agent, random delays (2-5s), scrolling. Filters: last 24h, entry-level. 3 category searches (ai/swe/data).
- **Indeed** (`indeed.js`): Scrapes public search results. Filters: `fromage=1` (last day), sorted by date. 3 category searches.

### Shared logic (`utils/helpers.js`)
- `makeJobId(url)`: SHA-256 hash of URL, first 16 chars
- `parsePostedAt(text)`: Converts "2 hours ago" style text to ISO datetime
- `isSeniorRole(title)`: Regex filter for senior/staff/principal/lead/manager/director/VP/architect keywords
- `classifyCategory(title, hint)`: Regex-based classification into 8 categories (ai/ml/fullstack/data-science/data-engineer/data-analyst/devops/swe)
- `retry(fn, retries, delay)`: Generic retry wrapper
- `sleep(ms)`: Promise-based delay

---

## Frontend Architecture

### Main Dashboard (`page.tsx`)
Single-file React client component (~487 lines) containing:
- **StatsBar**: 5 stat cards (total, new, last 24h, applied, last scraped)
- **FilterBar**: Search input (debounced 400ms), category chips (9 options), source chips (9 options), Scrape Now button
- **StatusTabs**: All / New / Saved / Applied / Hidden
- **JobCard**: Company logo (Clearbit API fallback to initials), title, company, metadata, category/source badges, action buttons (Apply/Save/Hide/Undo)
- **Pagination**: Windowed page buttons (max 7 visible)
- **Toast**: Auto-dismissing notifications (3s)
- Polls stats every 30 seconds

### Settings Page (`settings/page.tsx`)
- Search keywords (AI/SWE/Data) as comma-separated textareas
- Scrape interval (hours)
- Senior role filter toggle
- Sources/companies info display

### API Client (`lib/api.ts`)
- Typed `apiFetch<T>()` wrapper with error handling
- `api` object with 7 methods matching backend endpoints
- TypeScript interfaces: `Job`, `JobsResponse`, `Stats`, `JobFilters`
- `NEXT_PUBLIC_API_URL` env var for production

### Styling (`globals.css`)
- Dark theme with CSS custom properties (940 lines)
- Design system: colors, gradients, shadows, border radii, transitions
- Responsive breakpoints: 1024px (3-col stats), 768px (2-col stats, wrapped cards)
- Custom scrollbar, animations (pulse-new, spin, slideIn)
- Category-specific badge colors, source-specific badge colors

---

## Environment Variables

### Backend
| Variable          | Required | Default        | Description                |
|------------------|----------|----------------|---------------------------|
| PORT             | No       | 4000           | Server port               |
| ALLOWED_ORIGIN   | No       | (none)         | Production frontend URL for CORS |
| ADZUNA_APP_ID    | No       | (none)         | Adzuna API credentials    |
| ADZUNA_APP_KEY   | No       | (none)         | Adzuna API credentials    |

### Frontend
| Variable              | Required | Default                  | Description          |
|----------------------|----------|--------------------------|---------------------|
| NEXT_PUBLIC_API_URL  | No       | http://localhost:4000/api | Backend API base URL |

---

## Development Commands

```bash
# Backend
cd backend && npm install
npx playwright install chromium     # Required for LinkedIn/Indeed scrapers
node src/server.js                  # Start server (port 4000)
node --watch src/server.js          # Dev mode with auto-reload

# Frontend
cd frontend && npm install
npm run dev                         # Start Next.js dev server (port 3000)
npm run build                       # Production build
npm run lint                        # ESLint check

# One-time migration
node backend/src/migrate-categories.js  # Re-classify all existing jobs
```

---

## Key Design Decisions

1. **SQLite over Postgres**: Single-user app, no need for multi-tenant DB. WAL mode gives good concurrent read performance. Data lives in `data/jobs.db` (gitignored).
2. **Prepared statements**: All DB queries are pre-compiled `db.prepare()` for performance and SQL injection prevention.
3. **Parallel API scrapers + sequential browser scrapers**: API scrapers are I/O-bound and safe to parallelize. Browser scrapers share one Chromium instance to reduce memory.
4. **Mutex on scraper**: `isRunning` flag in scheduler prevents concurrent scrape runs.
5. **URL-based deduplication**: SHA-256 hash of job URL as primary key + UNIQUE constraint on URL ensures no duplicates.
6. **INSERT OR IGNORE**: Silently skips duplicate jobs instead of erroring.
7. **Client-side rendering**: Dashboard is a `'use client'` component. Stats poll every 30s. No SSR needed for this personal tool.
8. **Single-file page component**: All dashboard logic in one file for simplicity (no component library overhead).
9. **Clearbit logos**: Company logos fetched from `logo.clearbit.com` with fallback to colored initials.
10. **Polite scraping**: Rate-limiting delays (300-500ms between API calls, 2-5s between browser pages), custom User-Agent, AbortSignal timeouts.

---

## Conventions

- **Backend**: ES modules (`"type": "module"`), no TypeScript, JSDoc comments, emoji console logging
- **Frontend**: TypeScript strict mode, path alias `@/*` -> `./src/*`, Tailwind CSS 4 with PostCSS
- **Naming**: kebab-case for categories (`data-science`, `data-engineer`), lowercase for sources (`greenhouse`, `simplifyjobs`)
- **Job statuses**: `new` -> `saved` / `applied` / `ignored`
- **Error handling**: `Promise.allSettled` for parallel scrapers, try/catch per scraper, errors logged to `scrape_runs.errors` as JSON array

---

## Industry Best Practices & Recommendations

### Security
- **Input validation**: Status endpoint validates against whitelist `['new', 'saved', 'applied', 'ignored']` - good.
- **CORS**: Origin whitelist with env var support - good.
- **SQL injection**: Prepared statements with named parameters throughout - good.
- **Recommendation**: Add rate limiting to API endpoints (e.g., `express-rate-limit`) to prevent abuse.
- **Recommendation**: Add Helmet.js for security headers (`helmet` middleware).
- **Recommendation**: Sanitize the `search` query parameter more strictly (currently uses LIKE with `%` wrapping, which is safe for SQLite but could be improved).
- **Recommendation**: The settings endpoint (`POST /api/settings`) accepts arbitrary key-value pairs with no validation - add a whitelist of allowed setting keys.

### Error Handling & Resilience
- **Good**: `Promise.allSettled` ensures one scraper failure doesn't kill the entire run.
- **Good**: Mutex guard (`isRunning`) prevents concurrent scrape runs.
- **Good**: `AbortSignal.timeout()` on all fetch calls prevents hanging requests.
- **Recommendation**: Add structured logging (e.g., `pino` or `winston`) instead of `console.log` with emojis for production.
- **Recommendation**: Add graceful shutdown handling (`SIGTERM`/`SIGINT`) to close the database connection cleanly.
- **Recommendation**: The scrape endpoint fires and forgets (`triggerScrape().catch(console.error)`) - consider adding a scrape status polling endpoint so the frontend can show real-time progress.

### Performance
- **Good**: WAL mode on SQLite enables concurrent reads during writes.
- **Good**: Database indexes on frequently filtered columns (status, category, source, scraped_at, is_new).
- **Good**: Prepared statements are compiled once at module load.
- **Recommendation**: Add database connection pooling or consider switching to `sql.js` with a worker thread for non-blocking queries in high-load scenarios.
- **Recommendation**: Consider caching the `/api/stats` response for a few seconds since it's polled every 30s by every connected client.
- **Recommendation**: The frontend loads ALL job cards at once per page (up to 50). Consider virtual scrolling for large datasets.

### Testing
- **Missing**: No test files exist anywhere in the project.
- **Recommendation**: Add unit tests for `helpers.js` (classifyCategory, isSeniorRole, parsePostedAt, makeJobId) - these are pure functions and easy to test.
- **Recommendation**: Add integration tests for API endpoints using `supertest`.
- **Recommendation**: Add scraper tests with fixture/mock data to verify parsing logic without hitting external APIs.
- **Recommendation**: Add `vitest` or `jest` to both backend and frontend.

### Code Quality
- **Recommendation**: The `direct.js` scraper has a local `classifyCategory()` that duplicates and is simpler than the shared one in `helpers.js`. Same issue in `adzuna.js`. Use the shared `classifyCategory` from helpers consistently.
- **Recommendation**: Extract `NEW_GRAD_KEYWORDS` into a shared constant since greenhouse.js, lever.js, and direct.js each define their own slightly different versions.
- **Recommendation**: The main `page.tsx` is 487 lines. Consider extracting `StatsBar`, `FilterBar`, `JobCard`, and `Pagination` into separate component files under `src/components/`.
- **Recommendation**: Add ESLint + Prettier configuration to the backend (frontend already has `next lint`).

### DevOps & Observability
- **Good**: Health check endpoint (`/api/health`) configured for Railway.
- **Good**: Dockerfile uses Playwright base image with proper layer caching.
- **Recommendation**: Add a `/api/scrape/status` endpoint to expose current scrape state (running/idle, last run stats).
- **Recommendation**: Add Docker Compose for local development (backend + frontend in one command).
- **Recommendation**: Add `.env.example` files documenting all environment variables.
- **Recommendation**: Consider adding Sentry or similar error tracking for production.
- **Recommendation**: Add database backup strategy (SQLite file can be copied/synced).

### Frontend
- **Good**: Debounced search input (400ms).
- **Good**: Responsive design with breakpoints.
- **Good**: TypeScript strict mode with proper interfaces.
- **Recommendation**: Add loading skeletons instead of a plain spinner for better UX.
- **Recommendation**: Add keyboard shortcuts (e.g., `j`/`k` to navigate jobs, `s` to save, `a` to apply).
- **Recommendation**: Consider using `next/image` for company logos instead of raw `<img>` tags (already configured in `next.config.mjs` but not used).
- **Recommendation**: Add error boundaries to gracefully handle component crashes.
- **Recommendation**: The `api.ts` client doesn't handle network retries - add retry logic for transient failures.

### Scraper Reliability
- **Recommendation**: LinkedIn and Indeed aggressively block bots. Consider adding proxy rotation support.
- **Recommendation**: Add a health check per scraper (e.g., verify the API endpoint is reachable before full scrape).
- **Recommendation**: Store raw scraper responses for debugging failed parses.
- **Recommendation**: Add scraper-specific error counts to the `scrape_runs` table for observability.
- **Recommendation**: The Workday scraper URL pattern (`{subdomain}.wd1.myworkdayjobs.com`) varies by company - some use wd5, wd2, etc. Consider making this configurable.

### Data Quality
- **Recommendation**: Add a job expiry mechanism (auto-archive jobs older than 30-60 days).
- **Recommendation**: Normalize company names across scrapers (e.g., "OpenAI" vs "Openai" vs "openai").
- **Recommendation**: Add duplicate detection beyond URL (e.g., same title + company + location within 7 days).
- **Recommendation**: Validate and normalize location strings (e.g., "San Francisco, CA" vs "SF" vs "San Francisco, California").

---

## Common Tasks

### Adding a new scraper
1. Create `backend/src/scrapers/newscaper.js`
2. Export an async function that returns `Job[]` with the standard shape (id, title, company, location, url, source, category, salary, description, posted_at)
3. Import and add to `scraper.js` in `apiScrapers` (if fetch-based) or `browserScrapers` (if Playwright-based)
4. Add source to the `SOURCES` array in `frontend/src/app/page.tsx`
5. Add a badge style `.badge-newsource` in `globals.css`

### Adding a new job category
1. Update `classifyCategory()` in `backend/src/utils/helpers.js` with new regex patterns
2. Add category to `CATEGORIES` array in `frontend/src/app/page.tsx`
3. Add badge style `.badge-cat-newcategory` in `globals.css`
4. Update the `Job.category` type union in `frontend/src/lib/api.ts`
5. Run `node backend/src/migrate-categories.js` to re-classify existing jobs

### Adding a new company to an existing scraper
- **Greenhouse**: Add company slug to `GREENHOUSE_COMPANIES` array in `greenhouse.js`
- **Lever**: Add company slug to `LEVER_COMPANIES` array in `lever.js`
- **Workday**: Add tenant object to `WORKDAY_TENANTS` array in `workday.js`
- **Direct**: Add feed object to `DIRECT_CAREER_FEEDS` array in `direct.js`

### Changing the scrape schedule
1. Modify the cron expression in `scheduler.js` (currently `'0 */4 * * *'`)
2. Or update `scrape_interval_hours` setting via the Settings UI (requires backend restart)

---

## File Sizes & Complexity

| File | Lines | Complexity |
|------|-------|-----------|
| frontend/src/app/globals.css | 940 | Large but well-organized with CSS custom properties |
| frontend/src/app/page.tsx | 487 | High - contains 6 components + main page. Should be split. |
| backend/src/scrapers/workday.js | 109 | Medium - Workday API is complex |
| backend/src/utils/helpers.js | 117 | Medium - core utility functions |
| backend/src/scrapers/adzuna.js | 129 | Medium |
| backend/src/scraper.js | 128 | Medium - orchestrator with error handling |
| frontend/src/lib/api.ts | 95 | Low - clean typed API client |
| backend/src/db.js | 143 | Medium - schema + all prepared statements |
| backend/src/server.js | 112 | Low - clean Express routes |
