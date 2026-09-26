// Same ntfy topic as scraper/notify.py and apply-bot/lib/notify.js — one
// source of truth for it, read from scraper/notify_config.json.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'scraper', 'notify_config.json');

function topic() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).ntfy_topic;
  } catch {
    return null;
  }
}

async function notifyNewJobs(jobs) {
  if (!jobs.length) return;
  const t = topic();
  if (!t) {
    console.warn('notify skipped: no ntfy_topic configured in scraper/notify_config.json');
    return;
  }
  const title = jobs.length === 1 ? 'Naukri: 1 new job' : `Naukri: ${jobs.length} new jobs`;
  const lines = jobs.slice(0, 10).map((j) => `${j.company} — ${j.role}`);
  if (jobs.length > 10) lines.push(`...and ${jobs.length - 10} more`);

  try {
    await fetch(`https://ntfy.sh/${t}`, {
      method: 'POST',
      body: lines.join('\n'),
      headers: { Title: title, Tags: 'briefcase', Click: jobs[0].job_url },
    });
  } catch (e) {
    console.warn('ntfy notification failed:', e.message);
  }
}

module.exports = { notifyNewJobs };
