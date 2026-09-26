require('dotenv').config();
const http = require('http');
const { runApplyRemote, submitRemote, rejectRemote } = require('./lib/run');

// This is the Render-hosted counterpart to server.js (the local helper).
// It runs headless, so there's no browser window for you to watch — instead
// it screenshots the review step and pushes it to your phone via ntfy, then
// waits for you to approve or reject through a link in that notification.
const PORT = process.env.PORT || 5056;
const BACKEND_URL = process.env.BACKEND_URL || '';

// The frontend button reuses your existing Job Tracker login (JWT) to call
// POST /apply/:id — we verify it's real by asking the backend itself,
// instead of inventing a second login just for this service.
async function isValidJwt(authHeader) {
  if (!authHeader) return false;
  try {
    const res = await fetch(`${BACKEND_URL}/api/jobs?status=all`, { headers: { Authorization: authHeader } });
    return res.status !== 401;
  } catch {
    return false;
  }
}

// The review/submit/reject links only ever go out over YOUR private ntfy
// topic (see scraper/notify_config.json) to a notification only you get, so
// a single shared secret here — not a per-user login — is the right amount
// of protection for "don't let a random visitor click these".
const REVIEW_TOKEN = process.env.REVIEW_TOKEN || '';

function validToken(req, url) {
  if (!REVIEW_TOKEN) return false;
  return url.searchParams.get('token') === REVIEW_TOKEN;
}

function html(body) {
  return `<!doctype html><html><body style="font-family:system-ui;max-width:480px;margin:40px auto;padding:0 16px">${body}</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  const applyMatch = url.pathname.match(/^\/apply\/(\d+)$/);
  if (req.method === 'POST' && applyMatch) {
    const jobId = applyMatch[1];
    if (!(await isValidJwt(req.headers.authorization))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'not logged in' }));
    }
    if (!REVIEW_TOKEN) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'REVIEW_TOKEN is not configured on this service' }));
    }

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const reviewUrl = `${proto}://${req.headers.host}/review/${jobId}?token=${REVIEW_TOKEN}`;
    runApplyRemote(jobId, (msg) => console.log(`[job ${jobId}]`, msg), reviewUrl)
      .catch((err) => console.error(`[job ${jobId}] failed:`, err.message));

    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, message: 'Filling the application now — you\'ll get a push notification to review it shortly.' }));
  }

  const reviewMatch = url.pathname.match(/^\/review\/(\d+)$/);
  if (req.method === 'GET' && reviewMatch) {
    const jobId = reviewMatch[1];
    if (!validToken(req, url)) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      return res.end(html('<p>Invalid or missing token.</p>'));
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html(`
      <h2>Review application — job ${jobId}</h2>
      <p>Check the screenshot in the notification, then decide:</p>
      <form method="POST" action="/apply/${jobId}/submit?token=${REVIEW_TOKEN}" style="margin-bottom:12px">
        <button type="submit" style="padding:10px 16px;font-size:16px">Confirm &amp; Submit</button>
      </form>
      <form method="POST" action="/apply/${jobId}/reject?token=${REVIEW_TOKEN}">
        <button type="submit" style="padding:10px 16px;font-size:16px">Discard (I'll do it myself)</button>
      </form>
    `));
  }

  const submitMatch = url.pathname.match(/^\/apply\/(\d+)\/submit$/);
  if (req.method === 'POST' && submitMatch) {
    const jobId = submitMatch[1];
    if (!validToken(req, url)) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      return res.end(html('<p>Invalid or missing token.</p>'));
    }
    try {
      const ok = await submitRemote(jobId);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html(ok ? '<p>Submitted. ✅</p>' : '<p>Could not find the submit button anymore — please finish this one on the site directly.</p>'));
    } catch (err) {
      res.writeHead(410, { 'Content-Type': 'text/html' });
      return res.end(html(`<p>${err.message}</p>`));
    }
  }

  const rejectMatch = url.pathname.match(/^\/apply\/(\d+)\/reject$/);
  if (req.method === 'POST' && rejectMatch) {
    const jobId = rejectMatch[1];
    if (!validToken(req, url)) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      return res.end(html('<p>Invalid or missing token.</p>'));
    }
    rejectRemote(jobId);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html('<p>Discarded — nothing was submitted.</p>'));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`apply-bot remote server listening on :${PORT}`);
  if (!REVIEW_TOKEN) console.warn('WARNING: REVIEW_TOKEN is not set — review/submit/reject links will all be rejected.');
});
