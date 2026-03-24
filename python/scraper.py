"""
Career Page Scraper using Scrapling
Visits company career pages, searches for new-grad jobs, outputs JSON to stdout.
Called by Node.js backend via child_process.
"""

import json
import sys
import hashlib
import re
from datetime import datetime
from pathlib import Path

# Load company lists
DATA_DIR = Path(__file__).parent.parent / "backend" / "src" / "data"

TITLE_KEYWORDS = [
    "software engineer", "software developer", "swe",
    "ai engineer", "ai developer",
    "data scientist", "data science",
    "ml engineer", "machine learning",
    "data analyst",
    "python developer",
    "full stack", "fullstack", "full-stack",
    "frontend engineer", "front-end", "front end",
    "backend engineer", "back-end", "back end",
    "data engineer", "analytics engineer",
    "devops", "cloud engineer", "sre",
    "new grad", "new graduate", "entry level", "entry-level",
    "junior", "associate",
]

SENIOR_KEYWORDS = [
    "senior", "staff", "principal", "lead", "manager", "director",
    "vp ", "vice president", "head of", "architect", "distinguished",
    "intern ", "internship", "co-op",
]

NEW_GRAD_KEYWORDS = [
    "new grad", "new graduate", "entry level", "entry-level",
    "junior", "2025", "2026", "associate", "early career",
    "university", "campus", "recent grad",
]


def make_job_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def is_relevant_title(title: str) -> bool:
    lower = title.lower()
    return any(kw in lower for kw in TITLE_KEYWORDS)


def is_senior(title: str) -> bool:
    lower = title.lower()
    return any(kw in lower for kw in SENIOR_KEYWORDS)


def classify_category(title: str) -> str:
    lower = title.lower()
    if any(kw in lower for kw in ["ai engineer", "llm", "generative ai", "nlp", "computer vision"]):
        return "ai"
    if any(kw in lower for kw in ["machine learning", "ml engineer", "deep learning"]):
        return "ml"
    if "full" in lower and "stack" in lower:
        return "fullstack"
    if any(kw in lower for kw in ["data scien", "applied scientist"]):
        return "data-science"
    if any(kw in lower for kw in ["data engineer", "analytics engineer", "etl", "data pipeline"]):
        return "data-engineer"
    if any(kw in lower for kw in ["data analyst", "business intelligence", "bi analyst"]):
        return "data-analyst"
    if any(kw in lower for kw in ["devops", "site reliability", "sre", "cloud engineer"]):
        return "devops"
    return "swe"


def load_companies():
    companies = []
    for filename in ["companies.json", "ai_companies.json"]:
        filepath = DATA_DIR / filename
        if filepath.exists():
            with open(filepath) as f:
                data = json.load(f)
                for c in data:
                    if c.get("careersUrl"):
                        companies.append(c)
    # Deduplicate by URL
    seen = set()
    unique = []
    for c in companies:
        url = c["careersUrl"]
        if url not in seen:
            seen.add(url)
            unique.append(c)
    return unique


def extract_jobs_from_page(page, company_name: str, source_url: str) -> list:
    """Extract job listings from a scrapled page."""
    jobs = []
    now = datetime.utcnow().isoformat() + "Z"

    # Strategy 1: Find all links that look like job postings
    all_links = page.css("a[href]")

    for link in all_links:
        href = link.attrib.get("href", "")
        text = link.text.strip() if link.text else ""

        if not text or len(text) < 5 or len(text) > 200:
            continue

        # Check if the link looks like a job posting
        job_url_patterns = [
            "/job", "/position", "/opening", "/career", "/apply",
            "/requisition", "jobId=", "job_id=", "/posting",
            "greenhouse.io", "lever.co", "ashbyhq.com", "workday",
        ]
        is_job_link = any(p in href.lower() for p in job_url_patterns)
        if not is_job_link:
            continue

        # Check title relevance
        if not is_relevant_title(text):
            continue
        if is_senior(text):
            continue

        # Make URL absolute
        if href.startswith("/"):
            from urllib.parse import urlparse
            parsed = urlparse(source_url)
            href = f"{parsed.scheme}://{parsed.netloc}{href}"

        jobs.append({
            "id": make_job_id(href),
            "title": text,
            "company": company_name,
            "location": "US",
            "url": href,
            "source": "scrapling",
            "category": classify_category(text),
            "salary": None,
            "description": None,
            "posted_at": now,
        })

    return jobs


def scrape_all():
    """Main scraping function — visits career pages with Scrapling."""
    try:
        from scrapling import StealthyFetcher
    except ImportError:
        print(json.dumps({"error": "scrapling not installed", "jobs": []}))
        return

    companies = load_companies()
    print(f"Scrapling: loaded {len(companies)} companies", file=sys.stderr)

    fetcher = StealthyFetcher()
    all_jobs = []
    hits = 0
    errors = 0

    # Limit to 100 companies per run to stay within time/memory limits
    for i, company in enumerate(companies[:100]):
        name = company.get("name", "Unknown")
        url = company["careersUrl"]

        try:
            print(f"  [{i+1}/100] {name}...", file=sys.stderr, end=" ")
            page = fetcher.fetch(url, timeout=10)

            if page.status != 200:
                print(f"HTTP {page.status}", file=sys.stderr)
                errors += 1
                continue

            jobs = extract_jobs_from_page(page, name, url)
            if jobs:
                all_jobs.extend(jobs)
                hits += 1
                print(f"{len(jobs)} jobs found", file=sys.stderr)
            else:
                print("0 jobs", file=sys.stderr)

        except Exception as e:
            print(f"error: {str(e)[:50]}", file=sys.stderr)
            errors += 1

    print(f"\nScrapling done: {len(all_jobs)} jobs from {hits} companies, {errors} errors", file=sys.stderr)

    # Output JSON to stdout for Node.js to consume
    print(json.dumps({"jobs": all_jobs, "total": len(all_jobs), "hits": hits, "errors": errors}))


if __name__ == "__main__":
    scrape_all()
