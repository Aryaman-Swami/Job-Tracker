// Local dedup store. This pipeline no longer writes to the Job Tracker DB
// (that's the DB's unique job_url index normally does the dedup job), so it
// needs its own record of what's already been surfaced, or every 4-hour run
// would re-notify the same still-listed postings forever.

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'seen_jobs.json');

function load() {
  try {
    return new Set(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
  } catch {
    return new Set();
  }
}

function save(set) {
  // Cap growth — keep the most recent 5000 URLs, plenty for this volume.
  const arr = Array.from(set).slice(-5000);
  fs.writeFileSync(STORE_PATH, JSON.stringify(arr));
}

module.exports = { load, save };
