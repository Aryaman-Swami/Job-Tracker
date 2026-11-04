"""Push notifications to your phone via ntfy.sh when new jobs are found.

Setup (one-time, on your phone):
  1. Install the "ntfy" app (Android/iOS), or just open https://ntfy.sh/<topic> in a browser.
  2. Subscribe to the topic in notify_config.json (default: see that file).
  3. That's it -- no account, no signup. Anyone who knows the topic name can
     read your notifications, so it's a random string rather than something
     guessable; treat it a bit like a secret.

To change the topic, edit notify_config.json.
"""

import json
import logging
import requests
from pathlib import Path

logger = logging.getLogger("workday_search")

CONFIG_PATH = str(Path(__file__).resolve().parent / "notify_config.json")


def _topic():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("ntfy_topic")
    except Exception:
        return None


def notify_new_jobs(jobs: list[dict], source_label: str):
    """jobs: list of {"company", "role", "job_url"} dicts that were newly added.

    Sends one notification per job (not batched) so each posting gets its
    own tap-through — unlike the naukri-scraper pipeline's notify.js, which
    deliberately stays batched.
    """
    if not jobs:
        return
    topic = _topic()
    if not topic:
        logger.warning("notify skipped: no ntfy_topic configured in notify_config.json")
        return

    for j in jobs:
        title = f"{source_label}: {j['company']}"
        message = j["role"]
        try:
            resp = requests.post(
                f"https://ntfy.sh/{topic}",
                data=message.encode("utf-8"),
                headers={
                    "Title": title.encode("utf-8"),
                    "Tags": "briefcase",
                    "Click": j["job_url"],
                },
                timeout=10,
            )
            resp.raise_for_status()
        except Exception as e:
            logger.warning(f"ntfy notification failed for {j.get('job_url')}: {e}")


def notify_run_summary(text: str, source_label: str, failed: bool = False):
    """One message per run even when nothing is new, so silence means the
    scheduled check did not run rather than 'no jobs'."""
    topic = _topic()
    if not topic:
        return
    try:
        requests.post(
            f"https://ntfy.sh/{topic}",
            data=text.encode("utf-8"),
            headers={
                "Title": f"{source_label} check {'FAILED' if failed else 'done'}".encode("utf-8"),
                "Tags": "warning" if failed else "white_check_mark",
                "Priority": "4" if failed else "2",
            },
            timeout=10,
        ).raise_for_status()
    except Exception as e:
        logger.warning(f"ntfy run-summary failed: {e}")
