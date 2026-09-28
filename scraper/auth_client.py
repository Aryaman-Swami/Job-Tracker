"""Logs into the backend's JWT auth once per process and hands back a
ready-to-use Authorization header, so run_scraper.py and workday_search.py
don't each need their own login/caching logic.
"""

import os
import requests

_cached_header = None


def get_auth_header(base_url: str) -> dict:
    global _cached_header
    if _cached_header is not None:
        return _cached_header

    username = os.environ.get("APP_USERNAME", "admin")
    password = os.environ.get("APP_PASSWORD", "admin")
    resp = requests.post(
        f"{base_url}/api/auth/login",
        json={"username": username, "password": password},
        timeout=10,
    )
    resp.raise_for_status()
    token = resp.json()["token"]
    _cached_header = {"Authorization": f"Bearer {token}"}
    return _cached_header
