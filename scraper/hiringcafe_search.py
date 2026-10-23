"""Hourly hiring.cafe job fetcher.

Approach: hiring.cafe sits behind a Cloudflare managed challenge that blocks
plain `requests` (HTTP 403 "Just a moment...") and its JSON endpoint
/api/search-jobs answers 401 to anonymous callers. The search page itself,
however, is server-rendered by Next.js: GET
https://hiring.cafe/?searchState=<json>&page=N returns the hits (~115 per page)
in `__NEXT_DATA__` -> props.pageProps.ssrHits, with hiring.cafe's structured
`v5_processed_job_data` (title, company, workplace countries/type, min years
of experience, tech tools, publish date, compensation) and the original
`apply_url`. The full HTML description comes from the public
GET /api/job-description?id=<objectID> (only fetched for jobs that already
passed every cheap filter).

Cloudflare accepts a Chrome TLS/HTTP2 fingerprint, so this uses `curl_cffi`
(`pip install curl_cffi`) with impersonate="chrome". No login, no account.

Politeness: ROLES x PAGES search requests (+ one description request per
surviving candidate), 4-8s random delay between requests, and a hard stop on
the first 403/429/challenge page (logged as BLOCKED, no retries).

Filters: software dev title, no intern/trainee/apprentice, not senior-level
title, not frontend/etc (shared TITLE_EXCLUDE), India (or worldwide-remote)
location, 2-6 yrs when stated, Java / Node.js / Spring Boot mentioned,
posted within MAX_AGE_DAYS.
"""

import json
import logging
import os
import random
import re
import time
import urllib.parse
from datetime import datetime, timezone
from html import unescape
from logging.handlers import RotatingFileHandler
from pathlib import Path

try:
    from curl_cffi import requests as cffi_requests
except ImportError:  # pragma: no cover
    raise SystemExit("curl_cffi is required: pip install curl_cffi")
import requests

from run_scraper import TITLE_EXCLUDE, LOCATION_EXCLUDE, COMPANY_EXCLUDE, clean
from notify import notify_new_jobs
from auth_client import get_auth_header

SCRIPT_DIR = Path(__file__).resolve().parent

_formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
_handler = RotatingFileHandler(str(SCRIPT_DIR / "hiringcafe_search.log"), maxBytes=1_000_000, backupCount=3)
_handler.setFormatter(_formatter)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_formatter)
logger = logging.getLogger("hiringcafe_search")
logger.setLevel(logging.INFO)
logger.addHandler(_handler)
logger.addHandler(_stream_handler)
logger.propagate = False

BASE_URL = os.environ.get("BACKEND_URL", f"http://localhost:{os.environ.get('PORT', '3000')}")
BACKEND = BASE_URL + "/api/jobs"

SITE = "https://hiring.cafe"
QUERIES = ["software engineer", "backend developer", "java developer", "node.js developer", "spring boot"]
PAGES = 2
MAX_AGE_DAYS = 14
DELAY = (4, 8)
DESC_DELAY = (2, 4)

TITLE_INCLUDE = [
    r"\bsoftware\s+(developer|engineer|development\s+engineer)\b",
    r"\bsde\b",
    r"\bback[\s-]?end\s+(developer|engineer)\b",
    r"\bfull[\s-]?stack\s+(developer|engineer)\b",
    r"\bjava\s+(developer|engineer)\b",
    r"\bnode(?:\.?js)?\s+(developer|engineer)\b",
]
# Shared TITLE_EXCLUDE bans "node.js"/"javascript" titles (Java-only scraper);
# this user also targets Node, so drop just those patterns.
_TITLE_EXCLUDE = [p for p in TITLE_EXCLUDE if not re.search(r"node|javascript", p, re.I)]
# Local enforcement, independent of run_scraper.py's TITLE_EXCLUDE.
NOT_ENTRY_TITLE = re.compile(r"\b(intern(ship)?s?|trainee|apprentice(ship)?|graduate\s+trainee)\b", re.I)
SENIOR_WORDS = re.compile(r"\b(senior|sr\.?|staff|principal|lead|architect|head|manager|vp|vice\s+president|director)\b", re.I)
TECH_INCLUDE = [r"\bjava\b", r"\bnode(?:\.?js)?\b", r"\bspring\s*boot\b"]
MIN_YEARS, MAX_YEARS = 2, 6

INDIA_STATE = {
    "type": "country", "formatted_address": "India", "types": ["country"],
    "geometry": {"location": {"lat": 20.5937, "lon": 78.9629}}, "id": "user_country",
    "address_components": [{"long_name": "India", "short_name": "IN", "types": ["country"]}],
    "options": {"flexible_regions": ["anywhere_in_continent", "anywhere_in_world"]},
}


class Blocked(Exception):
    pass


def fetch_hits(session, query, page):
    state = {"searchQuery": query, "dateFetchedPastNDays": MAX_AGE_DAYS, "sortBy": "date",
             "locations": [INDIA_STATE]}
    url = f"{SITE}/?searchState={urllib.parse.quote(json.dumps(state))}" + (f"&page={page}" if page else "")
    resp = session.get(url, timeout=40)
    if resp.status_code in (403, 429) or "Just a moment" in resp.text[:3000]:
        raise Blocked(f"search '{query}' p{page} -> HTTP {resp.status_code} (Cloudflare block)")
    resp.raise_for_status()
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.S)
    if not m:
        raise Blocked(f"search '{query}' p{page} -> no __NEXT_DATA__ (challenge page or layout change)")
    pp = json.loads(m.group(1))["props"]["pageProps"]
    if pp.get("ssrError"):
        raise Blocked(f"search '{query}' p{page} -> ssrError {pp['ssrError']}")
    return pp.get("ssrHits") or [], bool(pp.get("ssrIsLastPage"))


def fetch_description(session, object_id):
    resp = session.get(f"{SITE}/api/job-description?id={urllib.parse.quote(object_id)}",
                       headers={"Referer": SITE + "/", "Accept": "application/json"}, timeout=30)
    if resp.status_code in (403, 429):
        raise Blocked(f"job-description -> HTTP {resp.status_code}")
    if not resp.ok:
        return None
    return ((resp.json().get("job") or {}).get("job_information") or {}).get("description")


def html_to_text(html):
    t = re.sub(r"(?i)<\s*(br|/p|/div|/li|/h\d|/tr)\b[^>]*>", "\n", html or "")
    t = re.sub(r"(?i)<li\b[^>]*>", "- ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = unescape(t).replace("\xa0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n\n", t).strip()


def years_ok(vp, text):
    lo = vp.get("min_industry_and_role_yoe")
    if isinstance(lo, (int, float)):
        return lo <= MAX_YEARS
    years = [int(n) for n in re.findall(r"(\d{1,2})\+?\s*(?:-\s*\d{1,2}\s*)?y(?:ea)?rs?\b", text, re.I)]
    if not years:
        return True  # unstated: let it through, title is already non-senior
    return min(years) <= MAX_YEARS and max(years) >= MIN_YEARS


def location_ok(vp):
    countries = vp.get("workplace_countries") or []
    if "IN" in countries:
        locs = vp.get("workplace_cities") or [vp.get("formatted_workplace_location") or ""]
        return any(not any(re.search(p, l, re.I) for p in LOCATION_EXCLUDE) for l in locs)
    # Remote roles open to anywhere
    return bool(vp.get("is_workplace_worldwide_ok")) and vp.get("workplace_type") == "Remote"


def comp_text(vp):
    lo, hi = vp.get("yearly_min_compensation"), vp.get("yearly_max_compensation")
    if lo is None and hi is None:
        return ""
    cur = vp.get("listed_compensation_currency") or ""
    return f"{cur} {int(lo) if lo else '?'}-{int(hi) if hi else '?'}/yr".strip()


def main():
    logger.info("=== hiring.cafe search run started ===")
    session = cffi_requests.Session(impersonate="chrome")
    added, skipped, filtered, raw, seen = 0, 0, 0, 0, set()
    added_jobs = []
    now = time.time()
    first = True
    candidates = []
    try:
        for query in QUERIES:
            for page in range(PAGES):
                if not first:
                    time.sleep(random.uniform(*DELAY))
                first = False
                hits, last = fetch_hits(session, query, page)
                n = 0
                for h in hits:
                    jid = h.get("objectID") or h.get("id")
                    if not jid or jid in seen:
                        continue
                    seen.add(jid)
                    n += 1
                    raw += 1
                    vp = h.get("v5_processed_job_data") or {}
                    title = clean((h.get("job_information") or {}).get("title") or vp.get("core_job_title"), "").strip()
                    company = clean(vp.get("company_name") or (h.get("enriched_company_data") or {}).get("name"), "").strip() or "Unknown"
                    pub = vp.get("estimated_publish_date_millis")
                    pre_text = " ".join([title, vp.get("requirements_summary") or "",
                                         " ".join(vp.get("technical_tools") or [])])
                    rejected = (
                        h.get("is_expired")
                        or not h.get("apply_url")
                        or (pub and now - pub / 1000 > MAX_AGE_DAYS * 86400)
                        or any(re.search(p, company, re.I) for p in COMPANY_EXCLUDE)
                        or NOT_ENTRY_TITLE.search(title)
                        or any(re.search(p, title, re.I) for p in _TITLE_EXCLUDE)
                        or not any(re.search(p, title, re.I) for p in TITLE_INCLUDE)
                        or SENIOR_WORDS.search(title)
                        or not location_ok(vp)
                        or not years_ok(vp, "")
                    )
                    if rejected:
                        filtered += 1
                        continue
                    candidates.append((jid, h, vp, title, company, pub, pre_text))
                logger.info(f"[{query} p{page}] hits={len(hits)} new={n}")
                if last:
                    break

        logger.info(f"raw={raw} candidates_after_cheap_filters={len(candidates)}")
        for jid, h, vp, title, company, pub, pre_text in candidates:
            time.sleep(random.uniform(*DESC_DELAY))
            desc = html_to_text(fetch_description(session, jid))
            combined = f"{pre_text} {desc}"
            if (not any(re.search(p, combined, re.I) for p in TECH_INCLUDE)
                    or not years_ok(vp, desc)):
                filtered += 1
                continue
            locs = vp.get("formatted_workplace_location") or ", ".join(vp.get("workplace_cities") or []) or "India"
            comp = comp_text(vp)
            wt = vp.get("workplace_type") or ""
            notes = ("Auto-fetched via hiring.cafe" + f" · {locs}" + (f" · {wt}" if wt else "")
                     + (f" · {comp}" if comp else ""))
            job_url = h["apply_url"]
            payload = {
                "company": company, "role": title, "job_url": job_url,
                "job_ref_id": f"hiringcafe-{jid}", "status": "to_ask", "source": "hiringcafe",
                "notes": notes, "description": desc or None,
                "date_posted": datetime.fromtimestamp(pub / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if pub else None,
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
    except Blocked as e:
        logger.error(f"BLOCKED, aborting run (no retries): {e}")
    except Exception as e:
        logger.error(f"Run aborted: {e}")
    notify_new_jobs(added_jobs, source_label="hiring.cafe")
    logger.info(f"=== Done. raw={raw} added={added} dupes={skipped} filtered={filtered} ===")
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] hiring.cafe search done. {added} new jobs added.")


if __name__ == "__main__":
    main()
