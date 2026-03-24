"""
Career Page Scraper — visits company career URLs and extracts job listings.
Uses requests + BeautifulSoup (no browser needed, works in slim containers).
Called by Node.js backend via child_process.
"""

import json
import sys
import hashlib
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

# Try multiple paths (local dev vs Docker)
_candidates = [
    Path(__file__).parent.parent / "backend" / "src" / "data",
    Path(__file__).parent.parent / "src" / "data",
    Path("/app/src/data"),
]
DATA_DIR = None
for p in _candidates:
    if p.exists():
        DATA_DIR = p
        break
if DATA_DIR is None:
    print(json.dumps({"jobs": [], "total": 0, "hits": 0, "errors": 1}))
    print(f"ERROR: No data dir found. Tried: {[str(p) for p in _candidates]}", file=sys.stderr)
    sys.exit(0)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

TITLE_KEYWORDS = [
    "software engineer", "software developer", "swe ",
    "ai engineer", "ai developer",
    "data scientist", "data science",
    "ml engineer", "machine learning",
    "data analyst",
    "python developer",
    "full stack", "fullstack", "full-stack",
    "frontend engineer", "front-end", "front end",
    "backend engineer", "back-end", "back end",
    "data engineer", "analytics engineer",
    "devops", "cloud engineer", "sre ",
    "new grad", "new graduate", "entry level", "entry-level",
    "junior developer", "junior engineer", "associate engineer",
]

SENIOR_KEYWORDS = [
    "senior", "staff", "principal", "lead", "manager", "director",
    "vp ", "vice president", "head of", "architect", "distinguished",
    "intern ", "internship", "co-op",
]

JOB_URL_PATTERNS = [
    "/job", "/position", "/opening", "/career", "/apply",
    "/requisition", "jobid=", "job_id=", "/posting",
    "greenhouse.io", "lever.co", "ashbyhq.com", "workday",
    "/roles/", "/opportunities",
]


def make_id(url):
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def is_relevant(title):
    t = title.lower()
    return any(kw in t for kw in TITLE_KEYWORDS)


def is_senior(title):
    t = title.lower()
    return any(kw in t for kw in SENIOR_KEYWORDS)


def classify(title):
    t = title.lower()
    if any(k in t for k in ["ai engineer", "llm", "generative ai", "nlp"]):
        return "ai"
    if any(k in t for k in ["machine learning", "ml engineer", "deep learning"]):
        return "ml"
    if "full" in t and "stack" in t:
        return "fullstack"
    if any(k in t for k in ["data scien", "applied scientist"]):
        return "data-science"
    if any(k in t for k in ["data engineer", "analytics engineer", "etl"]):
        return "data-engineer"
    if any(k in t for k in ["data analyst", "business intelligence"]):
        return "data-analyst"
    if any(k in t for k in ["devops", "site reliability", "sre", "cloud engineer"]):
        return "devops"
    return "swe"


def load_companies():
    companies = []
    for fname in ["companies.json", "ai_companies.json"]:
        fp = DATA_DIR / fname
        if fp.exists():
            with open(fp) as f:
                for c in json.load(f):
                    if c.get("careersUrl"):
                        companies.append(c)
    seen = set()
    unique = []
    for c in companies:
        url = c["careersUrl"]
        if url not in seen:
            seen.add(url)
            unique.append(c)
    return unique


def scrape_one(company):
    """Scrape a single company career page. Returns list of jobs."""
    name = company.get("name", "Unknown")
    url = company["careersUrl"]
    jobs = []

    try:
        resp = requests.get(url, headers=HEADERS, timeout=8, allow_redirects=True)
        if resp.status_code != 200:
            return jobs

        soup = BeautifulSoup(resp.text, "lxml")
        base_url = resp.url

        # Find all links
        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True)

            if not text or len(text) < 5 or len(text) > 200:
                continue

            # Check if link looks like a job posting
            href_lower = href.lower()
            if not any(p in href_lower for p in JOB_URL_PATTERNS):
                continue

            if not is_relevant(text):
                continue
            if is_senior(text):
                continue

            # Make absolute URL
            full_url = urljoin(base_url, href)

            jobs.append({
                "id": make_id(full_url),
                "title": text,
                "company": name,
                "location": company.get("state", "US"),
                "url": full_url,
                "source": "scrapling",
                "category": classify(text),
                "salary": None,
                "description": None,
                "posted_at": datetime.utcnow().isoformat() + "Z",
            })

    except Exception:
        pass

    return jobs


def main():
    companies = load_companies()
    print(f"Python scraper: loaded {len(companies)} companies", file=sys.stderr)

    all_jobs = []
    hits = 0
    seen_titles = set()

    # Scrape in parallel — 20 threads
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(scrape_one, c): c for c in companies}
        for future in as_completed(futures):
            company = futures[future]
            try:
                jobs = future.result()
                # Dedup by title+company
                unique_jobs = []
                for j in jobs:
                    key = j["title"].lower() + "|" + j["company"].lower()
                    if key not in seen_titles:
                        seen_titles.add(key)
                        unique_jobs.append(j)

                if unique_jobs:
                    all_jobs.extend(unique_jobs)
                    hits += 1
                    print(f"  {company['name']}: {len(unique_jobs)} jobs", file=sys.stderr)
            except Exception:
                pass

    print(f"Python scraper done: {len(all_jobs)} jobs from {hits} companies", file=sys.stderr)
    print(json.dumps({"jobs": all_jobs, "total": len(all_jobs), "hits": hits, "errors": 0}))


if __name__ == "__main__":
    main()
