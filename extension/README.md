# Job Tracker Auto-Apply (Chrome extension)

Pulls `to_ask` jobs from the Job Tracker backend and applies on Greenhouse, Lever, Ashby and Workday
using the tailored resume (generated via `/api/tailor` + `/api/pdf` if missing).

## Install
1. `chrome://extensions` → Developer mode → **Load unpacked** → select this `extension/` folder.
2. Open the extension's **Settings**: backend URL + login, your profile, Workday account, screening answers.
3. Be logged in to nothing special — Greenhouse/Lever/Ashby are guest forms; Workday uses the account in settings.
4. Popup → **Start**.

## Behaviour
- Queue: `status=to_ask`, supported host, not `needs_referral`, no prior `[auto-apply]` note; highest ATS score first.
- One job at a time, in a background tab, 30–90 s between jobs, daily cap (default 15).
- Success -> status `applied`. Anything else (unanswered required question, captcha, validation error,
  timeout) -> **status unchanged**, reason appended to notes as `[auto-apply] ...`, tab left open, job not retried.
- Never guesses at required questions: add a rule to *Screening answers* and clear the note to retry.
- Untick *Auto-submit* in Settings to fill only and review manually.
