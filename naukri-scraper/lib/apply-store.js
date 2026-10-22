// Per-URL apply ledger (separate from seen_jobs.json, which only tracks
// "already notified"). Decides what still needs an apply attempt and enforces
// the daily cap across runs.
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'applied_jobs.json');
const TERMINAL = new Set(['applied', 'already_applied', 'external', 'expired']);
const MAX_ATTEMPTS = 3; // for retryable statuses (error / needs_input)

function load() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch { return {}; }
}
function save(store) { fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 1)); }

function needsAttempt(store, url) {
  const e = store[url];
  if (!e) return true;
  if (TERMINAL.has(e.status)) return false;
  if ((e.status === 'error' || e.status === 'needs_input') && (e.attempts || 0) >= MAX_ATTEMPTS) return false;
  return true; // session_expired / limit_reached / skipped retry next run
}

function record(store, url, info, status) {
  const prev = store[url] || {};
  store[url] = { ...prev, ...info, status, at: new Date().toISOString(), attempts: (prev.attempts || 0) + 1 };
}

function appliedToday(store) {
  const day = new Date().toISOString().slice(0, 10);
  return Object.values(store).filter((e) => e.status === 'applied' && (e.at || '').startsWith(day)).length;
}

module.exports = { load, save, needsAttempt, record, appliedToday };
