"""Greenhouse job-board fetcher (India SWE/backend roles).

Uses Greenhouse's public, unauthenticated JSON API
(https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true) for a
curated list of board tokens verified to return HTTP 200 and to carry India
listings. No login, no browser. Boards are fetched in a small thread pool with
per-request timeouts and an overall deadline so the run can never hang.

Filters: software/backend/full-stack title (shared TITLE_EXCLUDE minus the
node/javascript patterns), India (or India-remote) location, Java / Node /
Spring Boot / TypeScript mentioned, stated minimum experience 2-6 years (kept if
unstated), posted within MAX_AGE_DAYS.

Usage: python greenhouse_search.py [--dry-run]
"""

import html
import json
import logging
import os
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests

from run_scraper import TITLE_EXCLUDE, LOCATION_EXCLUDE, COMPANY_EXCLUDE, clean
from notify import notify_new_jobs
from auth_client import get_auth_header

SCRIPT_DIR = Path(__file__).resolve().parent

_formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
_handler = RotatingFileHandler(str(SCRIPT_DIR / "greenhouse_search.log"), maxBytes=1_000_000, backupCount=3)
_handler.setFormatter(_formatter)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_formatter)
logger = logging.getLogger("greenhouse_search")
logger.setLevel(logging.INFO)
logger.addHandler(_handler)
logger.addHandler(_stream_handler)
logger.propagate = False

BASE_URL = os.environ.get("BACKEND_URL", f"http://localhost:{os.environ.get('PORT', '3000')}")
BACKEND = BASE_URL + "/api/jobs"

# Verified (HTTP 200 + at least one India listing) on 2026-10-25.
BOARDS = {
    "groww": "Groww", "mongodb": "MongoDB", "databricks": "Databricks", "stripe": "Stripe",
    "twilio": "Twilio", "datadog": "Datadog", "elastic": "Elastic", "okta": "Okta",
    "samsara": "Samsara", "airbnb": "Airbnb", "coinbase": "Coinbase", "gitlab": "GitLab",
    "rubrik": "Rubrik", "zscaler": "Zscaler", "netskope": "Netskope", "toast": "Toast",
    "fivetran": "Fivetran", "vercel": "Vercel", "sumologic": "Sumo Logic", "mixpanel": "Mixpanel",
    "appsflyer": "AppsFlyer", "newrelic": "New Relic", "anthropic": "Anthropic", "figma": "Figma",
    "scaleai": "Scale AI", "druva": "Druva", "zenoti": "Zenoti", "grafanalabs": "Grafana Labs",
    "cockroachlabs": "Cockroach Labs", "hackerrank": "HackerRank", "yugabyte": "Yugabyte",
    "purestorage": "Pure Storage", "commvault": "Commvault", "zuora": "Zuora",
    "flexport": "Flexport", "anaplan": "Anaplan", "agoda": "Agoda",
}

MAX_AGE_DAYS = 30
MIN_YEARS, MAX_YEARS = 2, 6
WORKERS = 6
REQUEST_TIMEOUT = 30
DEADLINE_SECONDS = 240

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")

TITLE_INCLUDE = [
    r"\bsoftware\s+(developer|engineer|development\s+engineer)\b",
    r"\bsde\b",
    r"\bback[\s-]?end\b",
    r"\bfull[\s-]?stack\b",
    r"\bjava\s+(developer|engineer)\b",
    r"\bmember\s+of\s+technical\s+staff\b",
    r"\bmts\b",
]
# Shared TITLE_EXCLUDE bans "node.js"/"javascript" titles (Java-only scraper);
# this user also targets Node, so drop just those patterns.
_TITLE_EXCLUDE = [p for p in TITLE_EXCLUDE if not re.search(r"node|javascript", p, re.I)]
_TITLE_EXCLUDE += [r"\b(manager|director|head|architect|vp|recruiter)\b"]
TECH_INCLUDE = [r"\bjava\b", r"\bnode(?:\.?js)?\b", r"\bspring\s*boot\b", r"\btypescript\b"]
INDIA_RE = re.compile(
    r"\b(india|bengaluru|bangalore|mumbai|pune|delhi|gurgaon|gurugram|noida|ahmedabad|kolkata|jaipur|"
    r"chandigarh|indore|coimbatore|thiruvananthapuram|vadodara|surat|nagpur|mysore|mysuru)\b", re.I)
YEARS_RE = re.compile(r"(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?y(?:ea)?rs?\b", re.I)

DRY_RUN = "--dry-run" in sys.argv


def html_to_text(raw):
    t = html.unescape(raw or "")           # content comes entity-escaped
    t = re.sub(r"(?i)<br\s*/?>|</(p|li|div|h\d|ul|ol)>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t).replace("\xa0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def location_ok(job):
    names = [(job.get("location") or {}).get("name") or ""]
    names += [o.get("name") or "" for o in (job.get("offices") or [])]
    ind = [n for n in names if INDIA_RE.search(n)]
    if not ind:
        return False
    return any(not any(re.search(p, n, re.I) for p in LOCATION_EXCLUDE) for n in ind)


def years_ok(text):
    years = [int(m.group(1)) for m in YEARS_RE.finditer(text)]
    years = [y for y in years if 1 <= y <= 15]
    if not years:
        return True  # unstated: keep
    return MIN_YEARS <= min(years) <= MAX_YEARS


def reject_reason(company, title, desc, ts, now):
    if ts and now - ts > MAX_AGE_DAYS * 86400:
        return "too_old"
    if any(re.search(p, company, re.I) for p in COMPANY_EXCLUDE):
        return "company_excluded"
    if any(re.search(p, title, re.I) for p in _TITLE_EXCLUDE):
        return "title_excluded"
    if not any(re.search(p, title, re.I) for p in TITLE_INCLUDE):
        return "title_not_included"
    return None


def fetch_board(token):
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    return r.json().get("jobs", [])


def process_board(token, now):
    """Return (listings, reasons, rejected_samples, passes). Pure; no POSTs."""
    company = BOARDS[token]
    jobs = fetch_board(token)
    reasons, rejected, passes = {}, [], []

    def rej(reason, title, loc):
        reasons[reason] = reasons.get(reason, 0) + 1
        rejected.append((company, title, loc, reason))

    for job in jobs:
        title = clean(job.get("title"), "").strip()
        loc = (job.get("location") or {}).get("name") or "-"
        if not location_ok(job):
            reasons["location"] = reasons.get("location", 0) + 1  # bulk: don't sample non-India
            continue
        ts = max(filter(None, [parse_ts(job.get("first_published")), parse_ts(job.get("updated_at"))]), default=None)
        reason = reject_reason(company, title, "", ts, now)
        if reason:
            rej(reason, title, loc)
            continue
        desc = html_to_text(job.get("content"))
        combined = f"{title} {desc}"
        if not any(re.search(p, combined, re.I) for p in TECH_INCLUDE):
            rej("no_tech_match", title, loc)
            continue
        if not years_ok(desc):
            rej("years", title, loc)
            continue
        passes.append({"company": company, "title": title, "loc": loc, "ts": ts, "desc": desc,
                       "id": job.get("id"), "board": token, "url": job.get("absolute_url")})
    return len(jobs), reasons, rejected, passes, token


def main():
    logger.info("=== Greenhouse search run started%s ===", " (dry-run)" if DRY_RUN else "")
    start = time.time()
    now = start
    total_reasons, rejected_samples, all_passes = {}, [], []
    ex = ThreadPoolExecutor(max_workers=WORKERS)
    futures = {ex.submit(process_board, t, now): t for t in BOARDS}
    done, not_done = wait(futures, timeout=DEADLINE_SECONDS)
    for f in done:
        token = futures[f]
        try:
            n, reasons, rejected, passes, _ = f.result()
        except Exception as e:
            logger.warning(f"[{token}] fetch failed: {e}")
            continue
        for k, v in reasons.items():
            total_reasons[k] = total_reasons.get(k, 0) + v
        rejected_samples += rejected
        all_passes += passes
        logger.info(f"[{token}] listings={n} passed={len(passes)}")
    for f in not_done:
        logger.warning(f"[{futures[f]}] skipped: overall deadline {DEADLINE_SECONDS}s reached")
    ex.shutdown(wait=False, cancel_futures=True)

    if DRY_RUN:
        logger.info(f"DRY-RUN reasons: {json.dumps(total_reasons)} passed={len(all_passes)}")
        print("REASONS:", json.dumps(total_reasons, indent=1))
        print(f"PASSED ({len(all_passes)}):")
        for p in all_passes:
            print("  P", (p["company"], p["title"], p["loc"]))
        print("REJECTED SAMPLES:")
        for s in random.sample(rejected_samples, min(30, len(rejected_samples))):
            print("  R", s)
        sys.stdout.flush()
        os._exit(0)  # don't wait on any straggler threads

    added, skipped = 0, 0
    added_jobs = []
    for p in all_passes:
        if time.time() - start > DEADLINE_SECONDS + 30:
            logger.warning("Posting stopped: overall time limit reached")
            break
        if not p["id"] or not p["url"]:
            continue
        payload = {
            "company": p["company"], "role": p["title"], "job_url": p["url"],
            "job_ref_id": f"greenhouse-{p['board']}-{p['id']}", "status": "to_ask", "source": "greenhouse",
            "notes": f"Auto-fetched via Greenhouse · {p['loc']}", "description": p["desc"] or None,
            "date_posted": datetime.fromtimestamp(p["ts"], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if p["ts"] else None,
        }
        try:
            r = requests.post(BACKEND, json=payload, headers=get_auth_header(BASE_URL), timeout=5)
            r.raise_for_status()
            if r.json().get("skipped"):
                skipped += 1
            else:
                added += 1
                added_jobs.append({"company": p["company"], "role": p["title"], "job_url": p["url"]})
                logger.info(f"ADDED {p['company']} | {p['title']} | {p['loc']} | {p['url']}")
        except Exception as e:
            logger.warning(f"Failed to post job {p['id']}: {e}")
    notify_new_jobs(added_jobs, source_label="Greenhouse")
    filtered = sum(total_reasons.values())
    logger.info(f"=== Done. added={added} dupes={skipped} filtered={filtered} ===")
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] Greenhouse search done. {added} new jobs added.")


if __name__ == "__main__":
    main()
