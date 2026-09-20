import re
import math
import requests
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List

app = FastAPI(title="JobSpy Scraper")

BACKEND = "http://localhost:3000/api/jobs"

EXP_INCLUDE = [
    r"\b[2-4]\s*[-–to]+\s*[2-5]\s*years?",
    r"\b[234]\+?\s*years?\s*(of\s+)?experience",
    r"\bmid[\s-]?level\b",
    r"\bintermediate\b",
    r"\b[23]\s*years?\b",
]
EXP_EXCLUDE = [
    r"\b[5-9]\+?\s*years?",
    r"\b1[0-9]\+?\s*years?",
    r"\bsenior\b",
    r"\bstaff\s+engineer\b",
    r"\bprincipal\b",
    r"\blead\s+(engineer|developer|dev)\b",
]


def clean(val, default=None):
    if val is None:
        return default
    if isinstance(val, float) and math.isnan(val):
        return default
    s = str(val).strip()
    return s if s and s.lower() != "nan" else default


class ScrapeRequest(BaseModel):
    search_term: str = "software developer"
    location: str = "India"
    results_wanted: int = 20
    hours_old: int = 48
    sites: List[str] = ["indeed", "linkedin", "zip_recruiter"]


@app.post("/scrape")
def scrape(req: ScrapeRequest):
    from jobspy import scrape_jobs

    try:
        jobs_df = scrape_jobs(
            site_name=req.sites,
            search_term=req.search_term,
            location=req.location,
            results_wanted=req.results_wanted,
            hours_old=req.hours_old,
            linkedin_fetch_description=False,
        )
    except Exception as e:
        return {"error": str(e), "added": 0, "skipped": 0, "total_scraped": 0}

    added, skipped, filtered = 0, 0, 0

    for _, job in jobs_df.iterrows():
        title = clean(job.get("title"), "Unknown")
        desc = clean(job.get("description"), "")
        combined = f"{title} {desc}"

        if any(re.search(p, combined, re.I) for p in EXP_EXCLUDE):
            filtered += 1
            continue
        if not any(re.search(p, combined, re.I) for p in EXP_INCLUDE):
            filtered += 1
            continue

        location_str = clean(job.get("location"), "")
        payload = {
            "company":     clean(job.get("company"), "Unknown"),
            "role":        title,
            "job_url":     clean(job.get("job_url")),
            "job_ref_id":  clean(job.get("id")),
            "status":      "to_ask",
            "source":      "n8n",
            "notes":       f"Auto-fetched · {location_str}".strip(" ·"),
            "date_posted": clean(job.get("date_posted")),
        }

        try:
            resp = requests.post(BACKEND, json=payload, timeout=5)
            if resp.json().get("skipped"):
                skipped += 1
            else:
                added += 1
        except Exception:
            pass

    return {
        "search_term":       req.search_term,
        "total_scraped":     len(jobs_df),
        "filtered_out":      filtered,
        "added":             added,
        "skipped_duplicates": skipped,
    }


@app.get("/health")
def health():
    return {"status": "ok"}
