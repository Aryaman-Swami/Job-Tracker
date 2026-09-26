"""In-house Indeed + LinkedIn job search, replacing the python-jobspy dependency.

Both sites are queried the same way jobspy did it under the hood -- Indeed's
mobile-app GraphQL API and LinkedIn's public "guest" job-search endpoint --
just reimplemented directly here so we control the request/retry behavior and
don't pull in jobspy's much larger dependency tree (pandas, etc.) for two
HTTP calls.

Every function returns a list of plain dicts with a common shape:
  title, company, location, job_url, description, date_posted, job_id
so callers can filter/post them identically regardless of source.
"""

from __future__ import annotations

import logging
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


def _fetch_linkedin_description(job_id: str, session: requests.Session) -> str:
    try:
        resp = session.get(f"https://www.linkedin.com/jobs/view/{job_id}", timeout=10)
        resp.raise_for_status()
    except Exception:
        return ""
    if "linkedin.com/signup" in resp.url:
        return ""
    soup = BeautifulSoup(resp.text, "html.parser")
    div = soup.find("div", class_=lambda c: c and "show-more-less-html__markup" in c)
    return div.get_text(separator=" ", strip=True) if div else ""


def search_linkedin(
    search_term: str,
    location: str = "India",
    results_wanted: int = 50,
    hours_old: int = 24,
    fetch_description: bool = False,
) -> list[dict]:
    session = requests.Session()
    session.headers.update(LINKEDIN_HEADERS)

    jobs = []
    seen_ids = set()
    start = 0
    max_requests = 6  # 25/page

    for _ in range(max_requests):
        if len(jobs) >= results_wanted:
            break
        params = {
            "keywords": search_term,
            "location": location,
            "start": start,
            "f_TPR": f"r{hours_old * 3600}",
        }
        try:
            resp = session.get(LINKEDIN_SEARCH_URL, params=params, timeout=15)
            if resp.status_code == 429:
                logger.warning("[linkedin] 429 — blocked for too many requests")
                break
            resp.raise_for_status()
        except Exception as e:
            logger.error(f"[linkedin] search failed for '{search_term}': {e}")
            break

        soup = BeautifulSoup(resp.text, "html.parser")
        cards = soup.find_all("div", class_="base-search-card")
        if not cards:
            break

        for card in cards:
            href_tag = card.find("a", class_="base-card__full-link")
            if not href_tag or "href" not in href_tag.attrs:
                continue
            job_id = _linkedin_job_id(href_tag["href"])
            if not job_id or job_id in seen_ids:
                continue
            seen_ids.add(job_id)

            title_tag = card.find("span", class_="sr-only")
            company_tag = card.find("h4", class_="base-search-card__subtitle")
            metadata = card.find("div", class_="base-search-card__metadata")
            location_tag = metadata.find("span", class_="job-search-card__location") if metadata else None
            date_tag = metadata.find("time", class_="job-search-card__listdate") if metadata else None

            description = _fetch_linkedin_description(job_id, session) if fetch_description else ""

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

        start += len(cards)
        time.sleep(1.5)  # be polite — this endpoint rate-limits aggressively

    return jobs[:results_wanted]
