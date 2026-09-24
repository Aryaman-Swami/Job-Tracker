import os
import re
import json
import math
import logging
import requests
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from jobspy import scrape_jobs
from auth_client import get_auth_header

SCRIPT_DIR = Path(__file__).resolve().parent

_handler = RotatingFileHandler(
    str(SCRIPT_DIR / "scraper.log"),
    maxBytes=1_000_000,
    backupCount=3,
)
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logging.basicConfig(level=logging.INFO, handlers=[_handler])

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")
BACKEND = BASE_URL + "/api/jobs"

ADZUNA_CONFIG_PATH = str(SCRIPT_DIR / "adzuna_config.json")
ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs/in/search/1"

SEARCHES = [
    # Experience-targeted
    {"search_term": "java developer 2 years experience",        "location": "India", "results_wanted": 50},
    {"search_term": "java developer 1 year experience",         "location": "India", "results_wanted": 50},
    {"search_term": "junior java developer",                    "location": "India", "results_wanted": 50},
    {"search_term": "java developer entry level",               "location": "India", "results_wanted": 50},
    # Role title-targeted
    {"search_term": "SDE 1 java",                               "location": "India", "results_wanted": 50},
    {"search_term": "SDE-1 java",                               "location": "India", "results_wanted": 50},
    {"search_term": "associate software engineer java",         "location": "India", "results_wanted": 50},
    {"search_term": "java software engineer",                   "location": "India", "results_wanted": 50},
    {"search_term": "java programmer",                          "location": "India", "results_wanted": 50},
    # Stack-targeted
    {"search_term": "java spring boot developer",               "location": "India", "results_wanted": 50},
    {"search_term": "java microservices developer",             "location": "India", "results_wanted": 50},
    {"search_term": "java backend engineer",                    "location": "India", "results_wanted": 50},
    {"search_term": "java rest api developer",                  "location": "India", "results_wanted": 50},
]

SITES = ["linkedin", "indeed"]

# Checked against job title always — before any description check
TITLE_EXCLUDE = [
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
    # seniority words
    r"\bsenior\b",
    r"\bsr\.?\b",
    r"\bstaff\b",
    r"\bprincipal\b",
    r"\blead\s+(engineer|developer|dev)\b",
    # any N+ in title
    r"\b[3-9]\+",
    r"\b1[0-9]\+",
]

MUST_CONTAIN = [r"\bjava\b"]

# Accept only explicit 1–2 year mentions
EXP_INCLUDE = [
    r"\b[12]\s*[-–to]+\s*[123]\s*y(ea)?rs?",   # 1-2, 1-3, 2-3 years/yrs
    r"\b[12]\s*y(ea)?rs?\s*(of\s+)?(experience|exp)\b",
    r"\b[12]\s*y(ea)?rs?\b",
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

# Block 3 years and above — including bare "3 years" (not just 3+)
EXP_EXCLUDE = [
    # Match "3 years", "4+ yrs" etc. but NOT the upper bound in "2-3 years"
    r"(?<![0-9\-])[3-9]\+?\s*y(ea)?rs?",
    r"(?<![0-9\-])1[0-9]\+?\s*y(ea)?rs?",
    r"\bsenior\b",
    r"\bstaff\b",
    r"\bprincipal\b",
    r"\blead\s+(engineer|developer|dev)\b",
    r"\bminimum\s+[3-9]",
    r"\bat\s+least\s+[3-9]",
]


def clean(val, default=None):
    if val is None:
        return default
    if isinstance(val, float) and math.isnan(val):
        return default
    s = str(val).strip()
    return s if s and s.lower() != "nan" else default


def run_search(search_term, location, results_wanted):
    logging.info(f"Searching: '{search_term}' in {location}")
    try:
        jobs_df = scrape_jobs(
            site_name=SITES,
            search_term=search_term,
            location=location,
            results_wanted=results_wanted,
            hours_old=24,
            job_type="fulltime",
            country_indeed="India",
            linkedin_fetch_description=False,
        )
    except Exception as e:
        logging.error(f"Scrape failed for '{search_term}': {e}")
        return 0, 0, 0

    added, skipped, filtered = 0, 0, 0

    for _, job in jobs_df.iterrows():
        title = clean(job.get("title"), "Unknown")
        desc = clean(job.get("description"), "")
        combined = f"{title} {desc}"

        company_name = clean(job.get("company"), "")
        if any(re.search(p, company_name, re.I) for p in COMPANY_EXCLUDE):
            filtered += 1
            continue

        # Always exclude frontend/UI titles
        if any(re.search(p, title, re.I) for p in TITLE_EXCLUDE):
            filtered += 1
            continue

        # Must contain java
        if not any(re.search(p, combined, re.I) for p in MUST_CONTAIN):
            filtered += 1
            continue

        if any(re.search(p, combined, re.I) for p in EXP_EXCLUDE):
            filtered += 1
            continue
        if desc:
            # Full filter when description is available
            if not any(re.search(p, combined, re.I) for p in EXP_INCLUDE):
                filtered += 1
                continue
        else:
            # No description — only hard-block explicit senior/3+ yr titles
            pass

        location_str = clean(job.get("location"), "")
        if any(re.search(p, location_str, re.I) for p in LOCATION_EXCLUDE):
            filtered += 1
            continue

        payload = {
            "company":     company_name or "Unknown",
            "role":        title,
            "job_url":     clean(job.get("job_url")),
            "job_ref_id":  clean(job.get("id")),
            "status":      "to_ask",
            "source":      "n8n",
            "notes":       f"Auto-fetched · {location_str}".strip(" ·"),
            "description": desc or None,
            "date_posted": clean(job.get("date_posted")),
        }

        try:
            resp = requests.post(BACKEND, json=payload, headers=get_auth_header(BASE_URL), timeout=5)
            if resp.json().get("skipped"):
                skipped += 1
            else:
                added += 1
        except Exception as e:
            logging.warning(f"Failed to post job: {e}")

    logging.info(f"  scraped={len(jobs_df)}, added={added}, dupes={skipped}, filtered={filtered}")
    return added, skipped, filtered


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

    for job in results:
        title = clean(job.get("title"), "Unknown")
        desc = clean(job.get("description"), "")
        combined = f"{title} {desc}"

        company_name = clean((job.get("company") or {}).get("display_name"), "")
        if any(re.search(p, company_name, re.I) for p in COMPANY_EXCLUDE):
            filtered += 1
            continue

        if any(re.search(p, title, re.I) for p in TITLE_EXCLUDE):
            filtered += 1
            continue

        if not any(re.search(p, combined, re.I) for p in MUST_CONTAIN):
            filtered += 1
            continue

        if any(re.search(p, combined, re.I) for p in EXP_EXCLUDE):
            filtered += 1
            continue
        if desc:
            if not any(re.search(p, combined, re.I) for p in EXP_INCLUDE):
                filtered += 1
                continue

        location_str = clean((job.get("location") or {}).get("display_name"), "")
        if any(re.search(p, location_str, re.I) for p in LOCATION_EXCLUDE):
            filtered += 1
            continue

        posted = clean(job.get("created"), "")
        notes = f"Auto-fetched via Adzuna · {location_str}".strip(" ·")

        payload = {
            "company":     company_name or "Unknown",
            "role":        title,
            "job_url":     clean(job.get("redirect_url")),
            "job_ref_id":  clean(job.get("id")),
            "status":      "to_ask",
            "source":      "n8n",
            "notes":       notes,
            "description": desc or None,
            "date_posted": posted or None,
        }

        try:
            resp2 = requests.post(BACKEND, json=payload, headers=get_auth_header(BASE_URL), timeout=5)
            if resp2.json().get("skipped"):
                skipped += 1
            else:
                added += 1
        except Exception as e:
            logging.warning(f"[adzuna] Failed to post job: {e}")

    logging.info(f"  [adzuna] scraped={len(results)}, added={added}, dupes={skipped}, filtered={filtered}")
    return added, skipped, filtered


if __name__ == "__main__":
    logging.info("=== Scraper run started ===")
    total_added = 0
    for s in SEARCHES:
        a, _, _ = run_search(s["search_term"], s["location"], s["results_wanted"])
        total_added += a

    adzuna_app_id, adzuna_app_key = load_adzuna_credentials()
    if adzuna_app_id and adzuna_app_key:
        for s in SEARCHES:
            a, _, _ = run_adzuna_search(adzuna_app_id, adzuna_app_key, s["search_term"], s["location"], s["results_wanted"])
            total_added += a
    else:
        logging.info(f"[adzuna] Skipped — no credentials in {ADZUNA_CONFIG_PATH}")

    logging.info(f"=== Done. Total new jobs added: {total_added} ===")
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] Done. {total_added} new jobs added.")
