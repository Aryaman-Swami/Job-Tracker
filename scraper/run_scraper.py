import os
import re
import json
import math
import logging
import time
import requests
from collections import Counter
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from job_sources import search_indeed, search_linkedin, fetch_linkedin_description
from auth_client import get_auth_header
from notify import notify_new_jobs

SCRIPT_DIR = Path(__file__).resolve().parent

_file_formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
_file_handler = RotatingFileHandler(
    str(SCRIPT_DIR / "scraper.log"),
    maxBytes=1_000_000,
    backupCount=3,
)
_file_handler.setFormatter(_file_formatter)
# Also log to stdout so this shows up in `render logs` — SyncService only
# captures the subprocess's stdout/stderr, not this file.
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_file_formatter)
logging.basicConfig(level=logging.INFO, handlers=[_file_handler, _stream_handler])

# Render assigns the actual listening port via PORT (Spring's own
# server.port=${PORT:3000} resolves it the same way) — mirror that here so
# this self-call lands on the right port instead of a hardcoded 3000.
BASE_URL = os.environ.get("BACKEND_URL", f"http://localhost:{os.environ.get('PORT', '3000')}")
BACKEND = BASE_URL + "/api/jobs"

ADZUNA_CONFIG_PATH = str(SCRIPT_DIR / "adzuna_config.json")
ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs/in/search/1"

_INDIA_TERMS = [
    # Experience-targeted
    "java developer 2 years experience",
    "java developer 1 year experience",
    "junior java developer",
    "java developer entry level",
    # Role title-targeted
    "SDE 1 java",
    "SDE-1 java",
    "associate software engineer java",
    "java software engineer",
    "java programmer",
    # Stack-targeted
    "java spring boot developer",
    "java microservices developer",
    "java backend engineer",
    "java rest api developer",
]
# Per-city searches: a plain "India" query is capped by LinkedIn's ranking and
# mostly returns the same top results for every term, so the long tail in each
# city was never reached. (Chennai/Hyderabad/Kochi are in LOCATION_EXCLUDE.)
_CITIES = ["Bengaluru", "Pune", "Mumbai", "Delhi NCR", "Noida", "Gurugram", "Ahmedabad"]
_CITY_TERMS = ["java developer", "java backend developer"]

SEARCHES = (
    [{"search_term": t, "location": "India", "results_wanted": 80} for t in _INDIA_TERMS]
    + [{"search_term": t, "location": c, "results_wanted": 60} for c in _CITIES for t in _CITY_TERMS]
    # f_WT=2 is LinkedIn's "Remote" work-type filter (LinkedIn only).
    + [{"search_term": t, "location": "India", "results_wanted": 60,
        "linkedin_params": {"f_WT": "2"}, "sites": ["linkedin"]} for t in _CITY_TERMS]
)

HOURS_OLD = 48  # server-side dedup makes overlap free; 24h missed jobs LinkedIn indexed late

SITES = ["linkedin", "indeed"]

# Checked against job title always — before any description check
TITLE_EXCLUDE = [
    # mobile roles
    r"\bandroid\b",
    r"\bios\b",
    r"\bmobile\s+(app|application|developer|engineer|dev|sdk)\b",
    # interns / trainees / apprentices — not full-time roles
    r"\bintern(s|ship|ships)?\b",
    r"\btrainee\b",
    r"\bapprentice(ship)?\b",
    # frontend / UI
    r"\bfront[\s-]?end\b",
    r"\bfrontend\b",
    r"\bui\s+(developer|engineer|dev)\b",
    r"\bui\/ux\b",
    r"\bux\s+(developer|designer|engineer)\b",
    r"\breact\.?js?\s*(developer|engineer|dev)?\b",
    r"\bangular\s+(developer|engineer|dev)\b",
    r"\bvue\s+(developer|engineer|dev)\b",
    r"\bjavascript\s+(developer|engineer|dev)\b",
    r"\bweb\s+(developer|designer)\b",
    r"\bnode\.?js\b",
    # seniority level codes (SDE3, L4, E5, IC4 …)
    r"\bSDE[-\s]?[3-9]\b",
    r"\bSD[-\s]?[3-9]\b",
    r"\bL[4-9]\b",
    r"\bE[4-9]\b",
    r"\bIC[3-9]\b",
    r"\bP[4-9]\b",
    # same level codes spelled as roman numerals (Engineer III, SDE-III, …) —
    # II is fine (that's our target level), III and up is not.
    r"\b(SDE|SD|engineer|developer|dev|analyst)[-\s]*(III|IV|V|VI|VII|VIII|IX|X)\b",
    # seniority words
    r"\bsenior\b",
    r"\bsr\.?\b",
    r"\bstaff\b",
    r"\bprincipal\b",
    # "lead" alone, not just "lead engineer/developer" — titles are usually
    # "Lead Software Engineer", "Lead Java Developer" etc, word not adjacent.
    r"\blead\b",
    # any N+ in title
    r"\b[3-9]\+",
    r"\b1[0-9]\+",
]

MUST_CONTAIN = [r"\bjava\b"]

# Accept 0-2 year mentions (and ranges starting at <=2 up to 5, e.g. "1 to 3
# years", "2-5 years"). A description with NO years mention at all is also
# accepted -- see reject_reason().
EXP_INCLUDE = [
    r"\b[0-2]\s*(?:[-–]|to)\s*[1-5]\s*\+?\s*y(ea)?rs?",   # 1-2, 1 to 3, 0-2, 2-5 years/yrs
    r"\b[12]\s*y(ea)?rs?\s*(of\s+)?(experience|exp)\b",
    r"\b[12]\s*\+?\s*y(ea)?rs?\b",
    r"\bjunior\b",
    r"\bentry[\s-]?level\b",
    r"\bfresher\b",
    r"\btrainee\b",
]

LOCATION_EXCLUDE = [
    r"\bchennai\b",
    r"\btamil\s*nadu\b",
    r"\bkochi\b",
    r"\bkerala\b",
    r"\bhyderabad\b",
    r"\btelangana\b",
]

COMPANY_EXCLUDE = [
    r"\bcapgemini\b",
    r"\btata\s+consultancy\b",
    r"\btcs\b",
    r"\binfosys\b",
    r"\bpersistent\s+systems?\b",
    r"\bdeloitte\b",
    r"\bwipro\b",
    r"\bhcl\b",
    r"\btechmahindra\b",
    r"\btech\s+mahindra\b",
    r"\bcognizant\b",
    r"\baccenture\b",
    r"\bmphasis\b",
    r"\blti\b",
    r"\bltimindtree\b",
    r"\bcoforge\b",
    r"\bhexaware\b",
    r"\bniit\b",
]

# Block 3 years and above — including bare "3 years" (not just 3+).
# The lookbehinds skip the upper bound of a range: "2-3 years", "1 to 3 years".
# Seniority words (senior/lead/staff/principal) are deliberately NOT checked
# against the description -- JDs say "collaborate with senior engineers" or
# "Lead and Senior developer" about colleagues; TITLE_EXCLUDE covers the title.
_NOT_RANGE_UPPER = r"(?<![0-9\-–])(?<!\bto )(?<!\band )(?<!- )(?<!– )"
EXP_EXCLUDE = [
    _NOT_RANGE_UPPER + r"[3-9]\+?\s*y(ea)?rs?\b",
    _NOT_RANGE_UPPER + r"1[0-9]\+?\s*y(ea)?rs?\b",
    r"\bminimum\s+(of\s+)?[3-9]\+?\s*y(ea)?rs?",
    r"\bat\s+least\s+[3-9]\+?\s*y(ea)?rs?",
]

# Any "N years" / "N-M yrs" style mention at all.
_YEARS_MENTION = re.compile(r"\d+\s*\+?\s*(?:[-–]|to)?\s*\d*\s*\+?\s*y(?:ea)?rs?\b", re.I)

# Per-stage counters across the whole run (logged at the end).
STATS = Counter()
_SEEN_PATH = SCRIPT_DIR / "linkedin_seen.json"
_SEEN_TTL = 7 * 86400


def _load_seen():
    try:
        data = json.loads(_SEEN_PATH.read_text(encoding="utf-8"))
        cutoff = time.time() - _SEEN_TTL
        return {k: v for k, v in data.items() if v > cutoff}
    except Exception:
        return {}


# LinkedIn ids whose description-based decision is final (posted or rejected),
# so overlapping searches/runs don't re-fetch their descriptions.
SEEN = _load_seen()


def _save_seen():
    try:
        _SEEN_PATH.write_text(json.dumps(SEEN), encoding="utf-8")
    except Exception as e:
        logging.warning(f"could not save {_SEEN_PATH}: {e}")


def _first(patterns, text):
    return next((p for p in patterns if re.search(p, text, re.I)), None)


def cheap_reject_reason(title, company, location):
    """Filters that need no description. Returns a reason string or None."""
    if _first(COMPANY_EXCLUDE, company):
        return "company"
    if _first(TITLE_EXCLUDE, title):
        return "title"
    if _first(LOCATION_EXCLUDE, location):
        return "location"
    return None


def reject_reason(title, desc, company, location):
    """Full filter pipeline. Returns a reason string, or None to accept."""
    r = cheap_reject_reason(title, company, location)
    if r:
        return r
    combined = f"{title} {desc}"
    if not _first(MUST_CONTAIN, combined):
        return "no_java"
    if _first(EXP_EXCLUDE, combined):
        return "exp_too_senior"
    if desc and not _first(EXP_INCLUDE, combined) and _YEARS_MENTION.search(combined):
        # States an experience figure, but not one in our 0-2(-5) range.
        return "exp_out_of_range"
    return None


def clean(val, default=None):
    if val is None:
        return default
    if isinstance(val, float) and math.isnan(val):
        return default
    s = str(val).strip()
    return s if s and s.lower() != "nan" else default


def _post_job(payload, stats):
    try:
        resp = requests.post(BACKEND, json=payload, headers=get_auth_header(BASE_URL), timeout=10)
        resp.raise_for_status()
        if resp.json().get("skipped"):
            stats["dupes"] += 1
            return "dupe"
        stats["added"] += 1
        return "added"
    except Exception as e:
        stats["post_failed"] += 1
        logging.warning(f"Failed to post job: {e}")
        return "failed"


def run_search(search_term, location, results_wanted, sites=None, linkedin_params=None):
    logging.info(f"Searching: '{search_term}' in {location}")
    sites = sites or SITES
    jobs = []
    if "indeed" in sites:
        try:
            jobs += search_indeed(search_term, location, results_wanted=results_wanted, hours_old=HOURS_OLD)
        except Exception as e:
            logging.error(f"[indeed] Scrape failed for '{search_term}': {e}")
    if "linkedin" in sites:
        try:
            jobs += search_linkedin(search_term, location, results_wanted=results_wanted,
                                    hours_old=HOURS_OLD, extra_params=linkedin_params)
        except Exception as e:
            logging.error(f"[linkedin] Scrape failed for '{search_term}': {e}")
    # Naukri is deliberately not in SITES — its search API 406s with
    # "recaptcha required" on unauthenticated/automated traffic (confirmed
    # live; see job_sources.search_naukri's docstring). Not something to
    # route around.

    stats = Counter()
    added_jobs = []
    stats["scraped"] = len(jobs)

    for job in jobs:
        title = clean(job.get("title"), "Unknown")
        desc = clean(job.get("description"), "")
        company_name = clean(job.get("company"), "")
        location_str = clean(job.get("location"), "")
        job_id = clean(job.get("job_id"), "")
        is_li = job_id.startswith("li-")

        if is_li and job_id in SEEN:
            stats["already_seen"] += 1
            continue

        reason = cheap_reject_reason(title, company_name, location_str)
        if reason:
            stats["rej_" + reason] += 1
            continue

        if is_li and not desc:
            # Search cards carry no description; fetch it now that the job
            # survived the cheap title/company/location filters.
            desc = fetch_linkedin_description(job_id[3:]) or ""
            time.sleep(0.7)
            if desc:
                stats["desc_fetched"] += 1
            else:
                stats["desc_fetch_failed"] += 1
                if not re.search(r"\bjava\b", title, re.I):
                    # Can't tell whether it's a Java job; retry on the next run
                    # rather than caching a decision made without the JD.
                    stats["rej_no_desc_no_java_title"] += 1
                    continue

        reason = reject_reason(title, desc, company_name, location_str)
        if reason:
            stats["rej_" + reason] += 1
            if is_li and desc:
                SEEN[job_id] = time.time()
            continue

        job_url = clean(job.get("job_url"))
        payload = {
            "company":     company_name or "Unknown",
            "role":        title,
            "job_url":     job_url,
            "job_ref_id":  job_id or None,
            "status":      "to_ask",
            "source":      "n8n",
            "notes":       f"Auto-fetched · {location_str}".strip(" ·"),
            "description": desc or None,
            "date_posted": clean(job.get("date_posted")),
        }
        outcome = _post_job(payload, stats)
        if outcome == "added":
            added_jobs.append({"company": payload["company"], "role": payload["role"], "job_url": job_url})
        if is_li and outcome != "failed" and desc:
            SEEN[job_id] = time.time()

    STATS.update(stats)
    filtered = sum(v for k, v in stats.items() if k.startswith("rej_"))
    logging.info(f"  scraped={stats['scraped']}, added={stats['added']}, dupes={stats['dupes']}, filtered={filtered} | "
                 + ", ".join(f"{k}={v}" for k, v in sorted(stats.items())
                              if k not in ("scraped", "added", "dupes")))
    return stats["added"], stats["dupes"], filtered, added_jobs


def load_adzuna_credentials():
    try:
        with open(ADZUNA_CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        return None, None
    app_id, app_key = cfg.get("app_id"), cfg.get("app_key")
    return (app_id, app_key) if app_id and app_key else (None, None)


def run_adzuna_search(app_id, app_key, search_term, location, results_wanted, max_days_old=1):
    logging.info(f"[adzuna] Searching: '{search_term}' in {location}")
    try:
        resp = requests.get(
            ADZUNA_BASE_URL,
            params={
                "app_id": app_id,
                "app_key": app_key,
                "what": search_term,
                "where": location,
                "results_per_page": min(results_wanted, 50),
                "max_days_old": max_days_old,
                "content-type": "application/json",
            },
            timeout=15,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
    except Exception as e:
        logging.error(f"[adzuna] Search failed for '{search_term}': {e}")
        return 0, 0, 0

    added, skipped, filtered = 0, 0, 0
    added_jobs = []

    for job in results:
        title = clean(job.get("title"), "Unknown")
        desc = clean(job.get("description"), "")
        combined = f"{title} {desc}"

        company_name = clean((job.get("company") or {}).get("display_name"), "")
        location_str = clean((job.get("location") or {}).get("display_name"), "")
        reason = reject_reason(title, desc, company_name, location_str)
        if reason:
            filtered += 1
            STATS["adzuna_rej_" + reason] += 1
            continue

        posted = clean(job.get("created"), "")
        notes = f"Auto-fetched via Adzuna · {location_str}".strip(" ·")

        job_url = clean(job.get("redirect_url"))
        payload = {
            "company":     company_name or "Unknown",
            "role":        title,
            "job_url":     job_url,
            "job_ref_id":  clean(job.get("id")),
            "status":      "to_ask",
            "source":      "n8n",
            "notes":       notes,
            "description": desc or None,
            "date_posted": posted or None,
        }

        try:
            resp2 = requests.post(BACKEND, json=payload, headers=get_auth_header(BASE_URL), timeout=5)
            resp2.raise_for_status()
            if resp2.json().get("skipped"):
                skipped += 1
            else:
                added += 1
                added_jobs.append({"company": payload["company"], "role": payload["role"], "job_url": job_url})
        except Exception as e:
            logging.warning(f"[adzuna] Failed to post job: {e}")

    logging.info(f"  [adzuna] scraped={len(results)}, added={added}, dupes={skipped}, filtered={filtered}")
    return added, skipped, filtered, added_jobs


if __name__ == "__main__":
    logging.info("=== Scraper run started ===")
    total_added = 0
    all_added_jobs = []
    for s in SEARCHES:
        a, _, _, added_jobs = run_search(s["search_term"], s["location"], s["results_wanted"],
                                         sites=s.get("sites"), linkedin_params=s.get("linkedin_params"))
        total_added += a
        all_added_jobs.extend(added_jobs)

    adzuna_app_id, adzuna_app_key = load_adzuna_credentials()
    if adzuna_app_id and adzuna_app_key:
        for s in SEARCHES:
            a, _, _, added_jobs = run_adzuna_search(adzuna_app_id, adzuna_app_key, s["search_term"], s["location"], s["results_wanted"])
            total_added += a
            all_added_jobs.extend(added_jobs)
    else:
        logging.info(f"[adzuna] Skipped — no credentials in {ADZUNA_CONFIG_PATH}")

    _save_seen()
    logging.info("=== Stage totals: " + ", ".join(f"{k}={v}" for k, v in sorted(STATS.items())) + " ===")

    # Same ntfy push notify.py already gives workday_search.py — this scraper
    # just never wired it up, so real jobs were being added silently.
    notify_new_jobs([j for j in all_added_jobs if j.get("job_url")], source_label="Indeed/LinkedIn/Adzuna")

    logging.info(f"=== Done. Total new jobs added: {total_added} ===")
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] Done. {total_added} new jobs added.")
