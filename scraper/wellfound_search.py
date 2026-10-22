"""Hourly Wellfound (ex-AngelList Talent) job fetcher.

Approach: Wellfound's public SEO landing pages
(https://wellfound.com/role/l/<role>/<location>[?page=N]) are server-rendered
by Next.js and ship the full search results -- title, company, locations,
compensation, liveStartAt, full description -- in the embedded
`__NEXT_DATA__` Apollo state. No login, no GraphQL calls, no Playwright and no
account is involved, so there is zero account-safety risk. (sitemap.xml is
403 and /graphql sits behind DataDome, so those were not used.)

Politeness: a handful of requests per run (ROLES x PAGES), 4-8s random delay
between them, a normal browser UA, and a hard stop on the first 403/429 or
captcha/challenge page (logged clearly, run exits without retrying).

Filters: software dev title, not frontend/etc (shared TITLE_EXCLUDE), not
senior-level title, India (or remote accepting India) location, 2-6 yrs
experience when stated, Java or Node.js tech mentioned.
"""

import json
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests

from run_scraper import TITLE_EXCLUDE, LOCATION_EXCLUDE, COMPANY_EXCLUDE, clean
from notify import notify_new_jobs
from auth_client import get_auth_header

SCRIPT_DIR = Path(__file__).resolve().parent

_formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
_handler = RotatingFileHandler(str(SCRIPT_DIR / "wellfound_search.log"), maxBytes=1_000_000, backupCount=3)
_handler.setFormatter(_formatter)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_formatter)
logger = logging.getLogger("wellfound_search")
logger.setLevel(logging.INFO)
logger.addHandler(_handler)
logger.addHandler(_stream_handler)
logger.propagate = False

BASE_URL = os.environ.get("BACKEND_URL", f"http://localhost:{os.environ.get('PORT', '3000')}")
BACKEND = BASE_URL + "/api/jobs"

ROLES = ["software-engineer", "backend-engineer", "java-developer", "full-stack-engineer"]
LOCATION = "india"
PAGES = 2
MAX_AGE_DAYS = 14
DELAY = (4, 8)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")

TITLE_INCLUDE = [
    r"\bsoftware\s+(developer|engineer|development\s+engineer)\b",
    r"\bsde\b",
    r"\bback[\s-]?end\s+(developer|engineer)\b",
    r"\bfull[\s-]?stack\s+(developer|engineer)\b",
    r"\bjava\s+(developer|engineer)\b",
]
# Shared TITLE_EXCLUDE bans "node.js"/"javascript" titles (Java-only scraper);
# this user also targets Node, so drop just those patterns.
_TITLE_EXCLUDE = [p for p in TITLE_EXCLUDE if not re.search(r"node|javascript", p, re.I)]
SENIOR_WORDS = re.compile(r"\b(senior|sr\.?|staff|principal|lead|architect|head|manager|intern)\b", re.I)
TECH_INCLUDE = [r"\bjava\b", r"\bnode(?:\.?js)?\b", r"\bspring\s*boot\b"]
MIN_YEARS, MAX_YEARS = 2, 6
INDIA_RE = re.compile(
    r"\b(india|bengaluru|bangalore|mumbai|pune|delhi|gurgaon|gurugram|noida|ahmedabad|kolkata|jaipur|"
    r"chandigarh|indore|coimbatore|thiruvananthapuram|vadodara|surat|nagpur|mysore|mysuru)\b", re.I)


class Blocked(Exception):
    pass


def fetch_page(session, role, page):
    url = f"https://wellfound.com/role/l/{role}/{LOCATION}" + (f"?page={page}" if page > 1 else "")
    resp = session.get(url, timeout=25)
    if resp.status_code in (403, 429) or "captcha-delivery" in resp.text[:5000]:
        raise Blocked(f"{url} -> HTTP {resp.status_code} (Cloudflare/DataDome block)")
    resp.raise_for_status()
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.S)
    if not m:
        raise Blocked(f"{url} -> no __NEXT_DATA__ (challenge page or layout change)")
    return json.loads(m.group(1))["props"]["pageProps"]["apolloState"]["data"]


def extract_jobs(apollo):
    """Yield (company_name, job_dict) for every listing, mapped via StartupResult."""
    job_company = {}
    for k, v in apollo.items():
        if k.startswith("StartupResult:"):
            for ref in v.get("highlightedJobListings", []):
                job_company[ref["__ref"]] = v.get("name")
    for k, v in apollo.items():
        if k.startswith("JobListingSearchResult:"):
            yield job_company.get(k), v


def md_to_text(md):
    t = re.sub(r"[*_`#>]+", "", md or "").replace("\xa0", " ")
    return re.sub(r"[ \t]+", " ", t).strip()


def years_ok(job, text):
    lo, hi = job.get("yearsExperienceMin"), job.get("yearsExperienceMax")
    if lo is not None or hi is not None:
        return (lo or 0) <= MAX_YEARS and (hi is None or hi >= MIN_YEARS)
    years = [int(n) for n in re.findall(r"(\d{1,2})\+?\s*(?:-\s*\d{1,2}\s*)?y(?:ea)?rs?\b", text, re.I)]
    if not years:
        return True  # unstated: let it through, title is already non-senior
    return min(years) <= MAX_YEARS and max(years) >= MIN_YEARS


def location_ok(job):
    names = (job.get("locationNames") or []) + (job.get("acceptedRemoteLocationNames") or [])
    ind = [n for n in names if INDIA_RE.search(n)]
    if ind:
        return any(not any(re.search(p, n, re.I) for p in LOCATION_EXCLUDE) for n in ind)
    return bool(job.get("remote")) and not (job.get("acceptedRemoteLocationNames") or [])


def main():
    logger.info("=== Wellfound search run started ===")
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept": "text/html,application/xhtml+xml",
                            "Accept-Language": "en-US,en;q=0.9"})
    added, skipped, filtered, seen = 0, 0, 0, set()
    added_jobs = []
    now = time.time()
    first = True
    try:
        for role in ROLES:
            for page in range(1, PAGES + 1):
                if not first:
                    time.sleep(random.uniform(*DELAY))
                first = False
                apollo = fetch_page(session, role, page)
                n = 0
                for company, job in extract_jobs(apollo):
                    jid = job.get("id")
                    if not jid or jid in seen:
                        continue
                    seen.add(jid)
                    n += 1
                    title = clean(job.get("title"), "").strip()
                    company = company or "Unknown"
                    desc = md_to_text(job.get("description"))
                    combined = f"{title} {desc}"
                    started = job.get("liveStartAt")
                    rejected = (
                        (started and now - started > MAX_AGE_DAYS * 86400)
                        or any(re.search(p, company, re.I) for p in COMPANY_EXCLUDE)
                        or any(re.search(p, title, re.I) for p in _TITLE_EXCLUDE)
                        or not any(re.search(p, title, re.I) for p in TITLE_INCLUDE)
                        or SENIOR_WORDS.search(title)
                        or not location_ok(job)
                        or not any(re.search(p, combined, re.I) for p in TECH_INCLUDE)
                        or not years_ok(job, combined)
                    )
                    if rejected:
                        filtered += 1
                        continue
                    job_url = f"https://wellfound.com/jobs/{jid}-{job.get('slug') or 'job'}"
                    locs = ", ".join(job.get("locationNames") or []) or ("Remote" if job.get("remote") else "")
                    comp = clean(job.get("compensation"), "")
                    notes = "Auto-fetched via Wellfound" + f" · {locs}" + (f" · {comp}" if comp else "")
                    payload = {
                        "company": company, "role": title, "job_url": job_url,
                        "job_ref_id": f"wellfound-{jid}", "status": "to_ask", "source": "wellfound",
                        "notes": notes, "description": desc or None,
                        "date_posted": datetime.fromtimestamp(started, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if started else None,
                    }
                    try:
                        r = requests.post(BACKEND, json=payload, headers=get_auth_header(BASE_URL), timeout=5)
                        r.raise_for_status()
                        if r.json().get("skipped"):
                            skipped += 1
                        else:
                            added += 1
                            added_jobs.append({"company": company, "role": title, "job_url": job_url})
                            logger.info(f"ADDED {company} | {title} | {locs} | {comp} | {job_url}")
                    except Exception as e:
                        logger.warning(f"Failed to post job {jid}: {e}")
                logger.info(f"[{role} p{page}] listings={n}")
    except Blocked as e:
        logger.error(f"BLOCKED, aborting run (no retries): {e}")
    except Exception as e:
        logger.error(f"Run aborted: {e}")
    notify_new_jobs(added_jobs, source_label="Wellfound")
    logger.info(f"=== Done. added={added} dupes={skipped} filtered={filtered} ===")
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] Wellfound search done. {added} new jobs added.")


if __name__ == "__main__":
    main()
