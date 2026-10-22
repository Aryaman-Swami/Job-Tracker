require('dotenv').config();
const http = require('http');
const { runApply } = require('./lib/run');

// Bound to 127.0.0.1 ONLY — never 0.0.0.0 — so this is reachable exclusively
// from your own browser on this machine, never from your network or the
// internet. The frontend (wherever it's hosted — Netlify, localhost, etc.)
// calls this directly from client-side JS, since the browser executing that
// JS is running on your machine too and can always reach its own localhost.
const PORT = Number(process.env.APPLY_BOT_PORT) || 5055;

// Explicit allow-list, not "*" — an open CORS policy here would let ANY page
// you have open in the browser silently trigger job applications on your
// behalf just by making a request to this port.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const running = new Set();

function withCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

const server = http.createServer((req, res) => {
  withCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, active: true, running: [...running] }));
  }

  const match = req.url.match(/^\/apply\/(\d+)$/);
  if (req.method === 'POST' && match) {
    const jobId = match[1];
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'origin not allowed' }));
    }

    if (running.has(jobId)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: `Job ${jobId} is already being applied to.` }));
    }

    running.add(jobId);
    runApply(jobId, (msg) => console.log(`[job ${jobId}]`, msg))
      .catch((err) => console.error(`[job ${jobId}] failed:`, err.message))
      .finally(() => running.delete(jobId));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, message: 'Launching Chrome — a browser window will open shortly.' }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`apply-bot local helper listening on http://127.0.0.1:${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
