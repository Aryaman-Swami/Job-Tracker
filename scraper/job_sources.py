"""In-house Indeed + LinkedIn + Naukri job search, replacing the
python-jobspy dependency.

Indeed and LinkedIn are queried the same way jobspy did it under the hood --
Indeed's mobile-app GraphQL API and LinkedIn's public "guest" job-search
endpoint. jobspy's bundled Naukri scraper hit a 406 recaptcha wall (see the
commit that dropped jobspy) — this one goes through Naukri's own site-search
JSON API (the same one naukri.com's own search page calls) with the specific
headers that API expects, instead of whatever jobspy was doing.

Every function returns a list of plain dicts with a common shape:
  title, company, location, job_url, description, date_posted, job_id
so callers can filter/post them identically regardless of source.
"""

from __future__ import annotations

import logging
import random
import re
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# --- Indeed --------------------------------------------------------------

INDEED_API_URL = "https://apis.indeed.com/graphql"
INDEED_BASE_URL = "https://in.indeed.com"

INDEED_HEADERS = {
    "Host": "apis.indeed.com",
    "content-type": "application/json",
    "indeed-api-key": "161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8",
    "accept": "application/json",
    "indeed-locale": "en-US",
    "accept-language": "en-US,en;q=0.9",
    "indeed-co": "IN",
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Indeed App 193.1",
    "indeed-app-info": "appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone",
}

INDEED_QUERY = """
    query GetJobData {{
        jobSearch(
        what: "{what}"
        location: {{where: "{location}", radius: 25, radiusUnit: MILES}}
        limit: 100
        {cursor}
        sort: RELEVANCE
        filters: {{
            date: {{
              field: "dateOnIndeed",
              start: "{hours_old}h"
            }}
        }}
        ) {{
        pageInfo {{
            nextCursor
        }}
        results {{
            job {{
            key
            title
            datePublished
            description {{ html }}
            location {{ countryCode formatted {{ long }} }}
            employer {{ name }}
            }}
        }}
        }}
    }}
    """


def _strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = text.replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def search_indeed(search_term: str, location: str = "India", results_wanted: int = 50, hours_old: int = 24) -> list[dict]:
    jobs = []
    cursor = None
    page = 0
    max_pages = 3  # 100/page — plenty for results_wanted values used by this project

    while len(jobs) < results_wanted and page < max_pages:
        query = INDEED_QUERY.format(
            what=search_term.replace('"', '\\"'),
            location=location,
            hours_old=hours_old,
            cursor=f'cursor: "{cursor}"' if cursor else "",
        )
        try:
            resp = requests.post(INDEED_API_URL, headers=INDEED_HEADERS, json={"query": query}, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            search = data.get("data", {}).get("jobSearch")
            if not search:
                logger.warning(f"[indeed] unexpected response shape: {data}")
                break
            results = search.get("results", [])
        except Exception as e:
            logger.error(f"[indeed] search failed for '{search_term}': {e}")
            break

        if not results:
            break

        for r in results:
            job = r.get("job") or {}
            key = job.get("key")
            if not key:
                continue
            country = (job.get("location") or {}).get("countryCode")
            if country and country != "IN":
                continue
            date_published = job.get("datePublished")
            date_posted = None
            if date_published:
                try:
                    date_posted = datetime.fromtimestamp(date_published / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                except Exception:
                    date_posted = None
            jobs.append({
                "title": job.get("title") or "Unknown",
                "company": (job.get("employer") or {}).get("name") or "Unknown",
                "location": (job.get("location") or {}).get("formatted", {}).get("long") or "",
                "job_url": f"{INDEED_BASE_URL}/viewjob?jk={key}",
                "job_id": f"in-{key}",
                "description": _strip_html((job.get("description") or {}).get("html")),
                "date_posted": date_posted,
            })

        cursor = search.get("pageInfo", {}).get("nextCursor")
        page += 1
        if not cursor:
            break

    return jobs[:results_wanted]


# --- LinkedIn --------------------------------------------------------------

LINKEDIN_SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
LINKEDIN_HEADERS = {
    "authority": "www.linkedin.com",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}


def _linkedin_job_id(href: str) -> str | None:
    href = href.split("?")[0]
    m = re.search(r"-(\d+)$", href)
    return m.group(1) if m else None


LINKEDIN_DETAIL_URLS = (
    "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{id}",  # light guest endpoint, rarely 429s
    "https://www.linkedin.com/jobs/view/{id}",
)


def _li_get(session: requests.Session, url: str, params: dict | None = None, retries: int = 4):
    """GET with exponential backoff on 429/5xx/network errors. Returns the
    Response, or None if every attempt failed (callers must treat None as
    "unknown", not "empty")."""
    for attempt in range(retries):
        try:
            resp = session.get(url, params=params, timeout=15)
            if resp.status_code == 429 or resp.status_code >= 500:
                wait = 5 * (2 ** attempt) + random.uniform(0, 2)
                logger.warning(f"[linkedin] HTTP {resp.status_code} for {url.split('?')[0][-60:]}; retry {attempt + 1}/{retries} in {wait:.0f}s")
                time.sleep(wait)
                continue
            return resp
        except requests.RequestException as e:
            wait = 3 * (2 ** attempt)
            logger.warning(f"[linkedin] request error {e!r}; retry {attempt + 1}/{retries} in {wait}s")
            time.sleep(wait)
    return None


def fetch_linkedin_description(job_id: str, session: requests.Session | None = None) -> str:
    """Full job description for a LinkedIn job id (numeric, no 'li-' prefix).
    Returns "" if it could not be fetched."""
    session = session or requests.Session()
    if not session.headers.get("user-agent"):
        session.headers.update(LINKEDIN_HEADERS)
    for tmpl in LINKEDIN_DETAIL_URLS:
        resp = _li_get(session, tmpl.format(id=job_id), retries=3)
        if resp is None or resp.status_code != 200 or "linkedin.com/signup" in resp.url:
            continue
        soup = BeautifulSoup(resp.text, "html.parser")
        div = soup.find("div", class_=lambda c: c and "show-more-less-html__markup" in c)
        if div:
            return div.get_text(separator=" ", strip=True)
    return ""


def search_linkedin(
    search_term: str,
    location: str = "India",
    results_wanted: int = 50,
    hours_old: int = 24,
    fetch_description: bool = False,
    extra_params: dict | None = None,
) -> list[dict]:
    session = requests.Session()
    session.headers.update(LINKEDIN_HEADERS)

    jobs = []
    seen_ids = set()
    start = 0
    # The guest endpoint returns ~10 cards/page and refuses start >= ~1000.
    max_requests = min(40, results_wanted // 10 + 3)
    empty_pages = 0

    for _ in range(max_requests):
        if len(jobs) >= results_wanted or start >= 1000:
            break
        params = {
            "keywords": search_term,
            "location": location,
            "start": start,
            "f_TPR": f"r{hours_old * 3600}",
            **(extra_params or {}),
        }
        resp = _li_get(session, LINKEDIN_SEARCH_URL, params=params)
        if resp is None:
            logger.error(f"[linkedin] giving up on '{search_term}' / {location} at start={start} (rate limited or network)")
            break
        if resp.status_code != 200:
            logger.error(f"[linkedin] HTTP {resp.status_code} for '{search_term}' / {location} at start={start}")
            break

        soup = BeautifulSoup(resp.text, "html.parser")
        cards = soup.find_all("div", class_="base-search-card")
        if not cards:
            break

        new_in_page = 0
        for card in cards:
            href_tag = card.find("a", class_="base-card__full-link")
            if not href_tag or "href" not in href_tag.attrs:
                continue
            job_id = _linkedin_job_id(href_tag["href"])
            if not job_id or job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            new_in_page += 1

            title_tag = card.find("span", class_="sr-only")
            company_tag = card.find("h4", class_="base-search-card__subtitle")
            metadata = card.find("div", class_="base-search-card__metadata")
            location_tag = metadata.find("span", class_="job-search-card__location") if metadata else None
            date_tag = metadata.find("time", class_="job-search-card__listdate") if metadata else None

            description = fetch_linkedin_description(job_id, session) if fetch_description else ""

            jobs.append({
                "title": title_tag.get_text(strip=True) if title_tag else "Unknown",
                "company": company_tag.get_text(strip=True) if company_tag else "Unknown",
                "location": location_tag.get_text(strip=True) if location_tag else "",
                "job_url": f"https://www.linkedin.com/jobs/view/{job_id}",
                "job_id": f"li-{job_id}",
                "description": description,
                "date_posted": date_tag["datetime"] if date_tag and date_tag.has_attr("datetime") else None,
            })

            if len(jobs) >= results_wanted:
                break

        # Pages that only repeat already-seen jobs mean paging has run dry.
        empty_pages = empty_pages + 1 if new_in_page == 0 else 0
        if empty_pages >= 2:
            break

        start += len(cards)
        time.sleep(1.5)  # be polite — this endpoint rate-limits aggressively

    return jobs[:results_wanted]


# --- Naukri ------------------------------------------------------------
#
# NOT wired into run_scraper.py's SITES — confirmed live (2026-09-26) that
# this endpoint 406s with {"message": "recaptcha required"} on
# unauthenticated/automated requests, no matter the headers. This is the
# same wall that got Naukri dropped from the old python-jobspy setup. Kept
# here, unused, in case a legitimate path (an official Naukri partner/API
# product, if one exists) becomes available later — not for working around
# the reCAPTCHA.

NAUKRI_SEARCH_URL = "https://www.naukri.com/jobapi/v3/search"
NAUKRI_HEADERS = {
    "authority": "www.naukri.com",
    "accept": "application/json",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # These two are what naukri.com's own frontend sends on every search
    # call — the API 403s without them.
    "appid": "109",
    "systemid": "Naukri",
    "referer": "https://www.naukri.com/",
}


def _naukri_placeholder(placeholders: list[dict], type_: str) -> str:
    for p in placeholders or []:
        if p.get("type") == type_:
            return p.get("label", "")
    return ""


def search_naukri(search_term: str, location: str = "India", results_wanted: int = 50, hours_old: int = 24) -> list[dict]:
    jobs = []
    page = 1
    max_pages = 3  # 20/page by default — plenty for results_wanted values used here

    while len(jobs) < results_wanted and page <= max_pages:
        params = {
            "noOfResults": 20,
            "urlType": "search_by_keyword",
            "searchType": "adv",
            "keyword": search_term,
            "location": location if location.lower() != "india" else "",
            "pageNo": page,
            "k": search_term,
            "seoKey": f"{search_term.replace(' ', '-').lower()}-jobs",
            "src": "jobsearchDesk",
            "latLong": "",
        }
        try:
            resp = requests.get(NAUKRI_SEARCH_URL, headers=NAUKRI_HEADERS, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            results = data.get("jobDetails") or []
        except Exception as e:
            logger.error(f"[naukri] search failed for '{search_term}' (page {page}): {e}")
            break

        if not results:
            break

        for job in results:
            job_id = job.get("jobId")
            if not job_id:
                continue
            url = job.get("jdURL") or job.get("staticUrl") or ""
            if url and not url.startswith("http"):
                url = f"https://www.naukri.com{url}"

            created = job.get("createdDate") or job.get("footerPlaceholderLabel")
            date_posted = None
            if isinstance(created, (int, float)):
                try:
                    date_posted = datetime.fromtimestamp(created / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                except Exception:
                    date_posted = None

            placeholders = job.get("placeholders") or []
            jobs.append({
                "title": job.get("title") or "Unknown",
                "company": job.get("companyName") or "Unknown",
                "location": _naukri_placeholder(placeholders, "location"),
                "job_url": url,
                "job_id": f"nk-{job_id}",
                "description": job.get("jobDescription") or "",
                "date_posted": date_posted,
            })

            if len(jobs) >= results_wanted:
                break

        page += 1
        time.sleep(1.5)  # be polite — same reason as the LinkedIn sleep above

    return jobs[:results_wanted]
