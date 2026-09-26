// Keeps a headless browser/page alive between the initial fill (which takes
// a screenshot and notifies you) and the later approved-submit call. Only
// the remote/headless flow uses this — the local, headed flow never needs
// to survive across separate HTTP requests.

const TTL_MS = 20 * 60 * 1000; // auto-cleanup if you never approve/reject

const sessions = new Map();

function set(jobId, session) {
  clear(jobId);
  const timer = setTimeout(() => {
    console.log(`[job ${jobId}] session expired after ${TTL_MS / 60000}min with no approval — closing.`);
    clear(jobId);
  }, TTL_MS);
  sessions.set(String(jobId), { ...session, timer });
}

function get(jobId) {
  return sessions.get(String(jobId));
}

function clear(jobId) {
  const s = sessions.get(String(jobId));
  if (!s) return;
  clearTimeout(s.timer);
  sessions.delete(String(jobId));
  s.browser?.close().catch(() => {});
}

module.exports = { set, get, clear };
