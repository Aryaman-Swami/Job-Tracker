"""Hourly Workday job fetcher.

Queries each configured company's own Workday "candidate experience" search
API directly (the same JSON endpoint their public career-site search box
uses) instead of scraping Google. This is far more reliable than the old
Google-based search, which returned the same static top-10 results every run.

Pipeline per company:
  1. Search the CXS `jobs` list endpoint (max limit=20/page, paginated),
     scoped to a jobFamilyGroup facet matching "Engineering"/"Technology" if
     the tenant exposes one.
  2. Cheaply pre-filter by title and freshness before fetching anything else.
  3. For survivors, fetch the CXS job-detail endpoint to get the real
     jobDescription, exact country/location, and startDate -- the list
     endpoint alone doesn't carry enough to apply the location/experience
     filters reliably.
  4. Apply the must-filters: India location, 2+ (but not senior-level) years
     of experience mentioned in the description, software developer/engineer
     title.

Freshness: Workday's public API has no true "last hour" facet -- the finest
signal is the per-posting `postedOn` bucket ("Posted Today", "Posted
Yesterday", ...). We keep only "Posted Today" and run this hourly; combined
with the backend's job_ref_id dedup (ON CONFLICT DO NOTHING), each run only
adds postings new since the last run -- in practice, jobs that appeared
within roughly the last hour, even though Workday can't promise that
precision itself.

To add a company: open one of its job posting URLs, e.g.
    https://<tenant>.<wd#>.myworkdayjobs.com/<site>/job/<...>
and add {"name", "tenant", "wd", "site"} to workday_companies.json.
"""

import json
import logging
import re
import requests
from datetime import datetime
from logging.handlers import RotatingFileHandler

from run_scraper import TITLE_EXCLUDE, LOCATION_EXCLUDE, COMPANY_EXCLUDE, clean
from notify import notify_new_jobs

_handler = RotatingFileHandler(
    r"c:\Users\hp\Projects\Job Tracker\scraper\workday_search.log",
    maxBytes=1_000_000,
    backupCount=3,
)
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
# Dedicated logger, not the root logger -- importing run_scraper runs its own
# logging.basicConfig() at import time, which would otherwise silently claim
# the root logger first and send these messages to scraper.log instead.
logger = logging.getLogger("workday_search")
logger.setLevel(logging.INFO)
logger.addHandler(_handler)

BACKEND = "http://localhost:3000/api/jobs"
COMPANIES_PATH = r"c:\Users\hp\Projects\Job Tracker\scraper\workday_companies.json"

SEARCH_TERMS = ["Software Engineer India", "Software Developer India"]
PAGE_SIZE = 20  # Workday's CXS API rejects limit > 20 with a 400
PAGES = 3  # up to 60 results per company per search term

FRESH_MARKERS = ("posted today", "just posted")

TITLE_INCLUDE = [
    r"\bsoftware\s+(developer|engineer)\b",
    r"\bsoftware\s+development\s+engineer\b",
    r"\bsde\b",
]

MIN_YEARS = 2
MAX_YEARS = 6  # heuristic ceiling so "8-12 years" senior postings don't sneak in via the years check

# \bjava\b deliberately won't match "javascript" (no word boundary after "java" there)
TECH_INCLUDE = [r"\bjava\b", r"\bnode(?:\.?js)?\b"]

FAMILY_KEYWORDS = ("engineer", "technology", "software", "development")

_facet_cache: dict[tuple, list[str]] = {}


def load_companies():
    with open(COMPANIES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def is_fresh(posted_on: str) -> bool:
    return bool(posted_on) and posted_on.strip().lower() in FRESH_MARKERS


def strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = text.replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def get_family_facet_ids(tenant: str, wd: str, site: str) -> list[str]:
    key = (tenant, wd, site)
    if key in _facet_cache:
        return _facet_cache[key]

    ids = []
    url = f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
    try:
        resp = requests.post(
            url,
            json={"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": ""},
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        for facet in resp.json().get("facets", []):
            if facet.get("facetParameter") != "jobFamilyGroup":
                continue
            for v in facet.get("values", []):
                descriptor = v.get("descriptor", "")
                if any(kw in descriptor.lower() for kw in FAMILY_KEYWORDS):
                    ids.append(v["id"])
    except Exception as e:
        logger.warning(f"[{tenant}] facet discovery failed: {e}")

    _facet_cache[key] = ids
    return ids


def years_in_range(text: str) -> bool:
    years = [int(n) for n in re.findall(r"(\d{1,2})\+?\s*y(?:ea)?rs?\b", text, re.I)]
    if not years:
        return False
    return min(years) >= MIN_YEARS and max(years) <= MAX_YEARS


SENIOR_WORDS = re.compile(r"\b(senior|staff|principal|lead|architect)\b", re.I)


def fetch_job_detail(tenant: str, wd: str, site: str, external_path: str):
    url = f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{external_path}"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    return resp.json().get("jobPostingInfo", {})


def search_company(company: dict, search_text: str):
    tenant, wd, site = company["tenant"], company["wd"], company["site"]
    url = f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"

    if any(re.search(p, company["name"], re.I) for p in COMPANY_EXCLUDE):
        return 0, 0, 0, []

    facet_ids = get_family_facet_ids(tenant, wd, site)
    applied_facets = {"jobFamilyGroup": facet_ids} if facet_ids else {}

    postings = []
    try:
        for page in range(PAGES):
            resp = requests.post(
                url,
                json={"appliedFacets": applied_facets, "limit": PAGE_SIZE, "offset": page * PAGE_SIZE, "searchText": search_text},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
            resp.raise_for_status()
            batch = resp.json().get("jobPostings", [])
            postings.extend(batch)
            if len(batch) < PAGE_SIZE:
                break
    except Exception as e:
        logger.error(f"[{company['name']}] search failed for '{search_text}': {e}")
        if not postings:
            return 0, 0, 0, []

    added, skipped, filtered = 0, 0, 0
    added_jobs = []

    for job in postings:
        title = clean(job.get("title"), "Unknown")
        posted_on = clean(job.get("postedOn"), "")

        if not is_fresh(posted_on):
            continue
        if any(re.search(p, title, re.I) for p in TITLE_EXCLUDE):
            filtered += 1
            continue
        if not any(re.search(p, title, re.I) for p in TITLE_INCLUDE):
            filtered += 1
            continue
        if SENIOR_WORDS.search(title):
            filtered += 1
            continue

        try:
            detail = fetch_job_detail(tenant, wd, site, job.get("externalPath", ""))
        except Exception as e:
            logger.warning(f"[{company['name']}] detail fetch failed for '{title}': {e}")
            filtered += 1
            continue

        country = (detail.get("jobRequisitionLocation") or {}).get("country") or {}
        if country.get("alpha2Code") != "IN":
            filtered += 1
            continue

        location_desc = clean((detail.get("jobRequisitionLocation") or {}).get("descriptor"), "")
        if any(re.search(p, location_desc, re.I) for p in LOCATION_EXCLUDE):
            filtered += 1
            continue

        description = strip_html(detail.get("jobDescription", ""))
        combined = f"{title} {description}"

        if not any(re.search(p, combined, re.I) for p in TECH_INCLUDE):
            filtered += 1
            continue

        # Senior-word exclusion stays title-only (checked above) -- description
        # text routinely mentions "senior engineers", "architects", "tech
        # leads" etc. as *colleagues*, not as a seniority requirement for
        # this role, so checking it here produces false positives.
        if not years_in_range(combined):
            filtered += 1
            continue

        job_url = clean(detail.get("externalUrl")) or f"https://{tenant}.{wd}.myworkdayjobs.com/{site}{job.get('externalPath', '')}"
        start_date = clean(detail.get("startDate"))

        payload = {
            "company": company["name"],
            "role": title,
            "job_url": job_url,
            "job_ref_id": job_url,
            "status": "to_ask",
            "source": "workday",
            "notes": f"Auto-fetched via Workday · {location_desc}".strip(" ·"),
            "description": description or None,
            "date_posted": f"{start_date}T00:00:00Z" if start_date else None,
        }

        try:
            r = requests.post(BACKEND, json=payload, timeout=5)
            if r.json().get("skipped"):
                skipped += 1
            else:
                added += 1
                added_jobs.append({"company": company["name"], "role": title, "job_url": job_url})
        except Exception as e:
            logger.warning(f"[{company['name']}] Failed to post job: {e}")

    logger.info(
        f"[{company['name']}] '{search_text}': scraped={len(postings)}, "
        f"added={added}, dupes={skipped}, filtered={filtered}"
    )
    return added, skipped, filtered, added_jobs


if __name__ == "__main__":
    logger.info("=== Workday search run started ===")
    total_added = 0
    all_added_jobs = []
    for company in load_companies():
        for term in SEARCH_TERMS:
            a, _, _, jobs = search_company(company, term)
            total_added += a
            all_added_jobs.extend(jobs)
    notify_new_jobs(all_added_jobs, source_label="Workday")
    logger.info(f"=== Done. Total new jobs added: {total_added} ===")
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] Workday search done. {total_added} new jobs added.")
