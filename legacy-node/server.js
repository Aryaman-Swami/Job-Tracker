const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const hackerRankRubric = require('./hackerrank-rubric');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'job_tracker',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'admin',
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      job_ref_id VARCHAR(255),
      company VARCHAR(255) NOT NULL,
      role VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      contact_email VARCHAR(255),
      job_url TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'to_ask',
      source VARCHAR(50) NOT NULL DEFAULT 'manual',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'manual'`);
  await pool.query(`ALTER TABLE jobs ALTER COLUMN job_ref_id TYPE VARCHAR(255)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_url_idx ON jobs (job_url) WHERE job_url IS NOT NULL`);
  await pool.query(`DROP INDEX IF EXISTS jobs_company_role_idx`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS needs_referral BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS linkedin_profile_url TEXT`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tailored_resume_latex TEXT`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS date_posted TIMESTAMP`);
  await pool.query(`DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days' AND status IN ('to_ask', 'declined', 'not_interested')`);
}

app.get('/api/jobs', async (req, res) => {
  const { status, source } = req.query;
  const conditions = [];
  const params = [];
  if (status && status !== 'all') { params.push(status); conditions.push(`status = $${params.length}`); }
  else { params.push('not_interested'); conditions.push(`status != $${params.length}`); }
  if (source) { params.push(source); conditions.push(`source = $${params.length}`); }
  if (req.query.needs_referral === 'true') { params.push(true); conditions.push(`needs_referral = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(`SELECT * FROM jobs ${where} ORDER BY created_at DESC`, params);
  res.json(result.rows);
});

app.post('/api/jobs', async (req, res) => {
  const { job_ref_id, company, role, contact_name, contact_email, job_url, status, source, notes, description, needs_referral, linkedin_profile_url, date_posted } = req.body;
  if (!company || !role) return res.status(400).json({ error: 'company and role are required' });
  try {
    const result = await pool.query(
      `INSERT INTO jobs (job_ref_id, company, role, contact_name, contact_email, job_url, status, source, notes, description, needs_referral, linkedin_profile_url, date_posted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [job_ref_id || null, company, role, contact_name || null, contact_email || null, job_url || null, status || 'to_ask', source || 'manual', notes || null, description || null, needs_referral || false, linkedin_profile_url || null, date_posted || null]
    );
    if (result.rows.length === 0) return res.json({ skipped: true });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/jobs failed:', err.message);
    res.status(500).json({ error: `Failed to save job: ${err.message}` });
  }
});

app.patch('/api/jobs/:id', async (req, res) => {
  const { id } = req.params;
  const { job_ref_id, company, role, contact_name, contact_email, job_url, status, notes, description, needs_referral, linkedin_profile_url } = req.body;
  try {
    const result = await pool.query(
      `UPDATE jobs SET
        job_ref_id = COALESCE($1, job_ref_id),
        company = COALESCE($2, company),
        role = COALESCE($3, role),
        contact_name = COALESCE($4, contact_name),
        contact_email = COALESCE($5, contact_email),
        job_url = COALESCE($6, job_url),
        status = COALESCE($7, status),
        notes = COALESCE($8, notes),
        description = COALESCE($9, description),
        needs_referral = COALESCE($11, needs_referral),
        linkedin_profile_url = COALESCE($12, linkedin_profile_url),
        updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [job_ref_id, company, role, contact_name, contact_email, job_url, status, notes, description, id, needs_referral ?? null, linkedin_profile_url ?? null]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /api/jobs/:id failed:', err.message);
    res.status(500).json({ error: `Failed to update job: ${err.message}` });
  }
});

function extractLatex(raw) {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  const docClassIdx = text.indexOf('\\documentclass');
  if (docClassIdx > 0) text = text.slice(docClassIdx);

  const endDocIdx = text.lastIndexOf('\\end{document}');
  if (endDocIdx !== -1) text = text.slice(0, endDocIdx + '\\end{document}'.length);

  return text.trim();
}

const RESUME_PATH = path.join(__dirname, 'resume.tex');

app.get('/api/resume', (req, res) => {
  try {
    const content = fs.readFileSync(RESUME_PATH, 'utf8');
    res.json({ content });
  } catch {
    res.json({ content: '' });
  }
});

app.post('/api/resume', (req, res) => {
  const { content } = req.body;
  fs.writeFileSync(RESUME_PATH, content || '', 'utf8');
  res.json({ ok: true });
});

app.post('/api/tailor/:id', async (req, res) => {
  const job = (await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id])).rows[0];
  if (!job) return res.status(404).json({ error: 'not found' });

  let resume = job.tailored_resume_latex;
  if (!resume) {
    try { resume = fs.readFileSync(RESUME_PATH, 'utf8'); }
    catch { return res.status(400).json({ error: 'No resume saved. Please save your resume first.' }); }
  }
  if (!resume.trim()) return res.status(400).json({ error: 'Resume is empty. Please save your resume first.' });

  const desc = job.description || `Role: ${job.role}\nCompany: ${job.company}${job.notes ? `\n${job.notes}` : ''}`;

  const { missing_keywords, suggestions, extra_instructions } = req.body?.atsFeedback || {};
  const atsSection = ((missing_keywords?.length || suggestions?.length))
    ? `\n=== ATS GAPS FROM LAST SCORE ===\nA previous ATS scan of this resume against this job found these gaps. Work in whichever of these are honestly true of the existing content — do not fabricate skills, tools, or experience that aren't already implied by the resume.\n${missing_keywords?.length ? `Missing keywords: ${missing_keywords.join(', ')}\n` : ''}${suggestions?.length ? `Suggestions: ${suggestions.join('; ')}\n` : ''}`
    : '';
  const extraSection = extra_instructions?.trim()
    ? `\n=== ADDITIONAL INSTRUCTIONS FROM CANDIDATE ===\n${extra_instructions.trim()}\n`
    : '';

  const prompt = `You are tailoring a candidate's LaTeX resume for a specific job.

STRICT RULES:
1. Keep the total word count within ±5% of the original. Do NOT add new bullet points, sections, or expand existing ones.
2. Only rewrite existing bullet points to better match the job description's language and keywords — do not invent new content, achievements, or skills that aren't already present in some form.
3. Before rewriting, find every skill, tool, or concept the job description mentions or clearly implies that is ALSO already true of the candidate somewhere in the resume (Skills section, Projects, or other Experience bullets) — including synonyms and close equivalents (e.g. JD "containerization" matches resume "Docker"; JD "unit testing" matches resume "unit-tested REST endpoints"). For every such match, make sure the JD's own wording appears at least once in the tailored bullets or summary, even if that means rephrasing an existing bullet rather than leaving it untouched. Do not skip a true, relevant keyword just because rewording takes effort — but never fabricate one that has no basis anywhere in the resume.
4. Reorder or re-emphasize bullets within existing sections if it helps relevance — don't restructure the document.
5. Keep all LaTeX structure, commands, packages, and formatting identical to the source. Only the text content of bullets/summary changes.
6. Replace the job-title phrase in the Professional Summary. It opens with a bolded title phrase, e.g. \\textbf{Software Engineer} — replace just that phrase's inner text with the target role "${job.role}". If that text is long or awkward inside the sentence, use a concise, natural equivalent instead of pasting it verbatim. Keep the \\textbf{} command itself — only the text inside it changes. Do this on every pass, even if the sentence still reads fine with the old title.

OUTPUT FORMAT:
Return ONLY the complete tailored LaTeX document, starting at \\documentclass and ending at \\end{document} — nothing else. No markdown code fences, no commentary before or after.
${atsSection}${extraSection}
=== JOB ===
Role: ${job.role}
Company: ${job.company}
${desc}

=== RESUME ===
${resume}`;

  const proc = spawn('claude', ['--print', '--dangerously-skip-permissions', '--disable-slash-commands', '--safe-mode', '--tools', '', '--model', 'sonnet', '--no-session-persistence'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => err += d);
  proc.on('close', async code => {
    if (code !== 0) return res.status(500).json({ ok: false, error: err.trim() || out.trim() });
    try {
      const docStart = out.indexOf('\\documentclass');
      const endMarker = '\\end{document}';
      const docEnd = out.lastIndexOf(endMarker);
      if (docStart === -1 || docEnd === -1) throw new Error('No LaTeX document in response');
      const rawLatex = sanitizeForAts(out.slice(docStart, docEnd + endMarker.length));

      const { latex, pages, note, compileFailed, errorLine } = enforceOnePage(rawLatex);
      if (compileFailed) {
        return res.status(500).json({
          ok: false,
          error: `Tailored resume failed to compile — kept your previous version.${errorLine ? ` (${errorLine})` : ''}`,
        });
      }
      await pool.query('UPDATE jobs SET tailored_resume_latex = $1, updated_at = NOW() WHERE id = $2', [latex, job.id]);
      res.json({ ok: true, latex, pages, note });
    } catch {
      res.status(500).json({ ok: false, error: 'Claude returned an unexpected response.' });
    }
  });
  proc.stdin.write(prompt, 'utf8');
  proc.stdin.end();
});

app.post('/api/tailor/:id/latex', async (req, res) => {
  const { latex } = req.body;
  if (!latex) return res.status(400).json({ error: 'No LaTeX content provided' });
  const result = await pool.query(
    'UPDATE jobs SET tailored_resume_latex = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [latex, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, job: result.rows[0] });
});

app.post('/api/ats-score/:id', async (req, res) => {
  const job = (await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id])).rows[0];
  if (!job) return res.status(404).json({ error: 'not found' });

  let resume = job.tailored_resume_latex;
  if (!resume) {
    try { resume = fs.readFileSync(RESUME_PATH, 'utf8'); }
    catch { return res.status(400).json({ error: 'No resume saved. Please save your resume first.' }); }
  }
  if (!resume.trim()) return res.status(400).json({ error: 'Resume is empty. Please save your resume first.' });

  const desc = job.description || `Role: ${job.role}\nCompany: ${job.company}${job.notes ? `\n${job.notes}` : ''}`;

  const prompt = `Analyze the resume against the job description and return ONLY a valid JSON object (no markdown, no code fences, no explanation) in exactly this format:
{
  "score": <integer 0-100>,
  "breakdown": {
    "keywords": <integer 0-100>,
    "skills": <integer 0-100>,
    "experience": <integer 0-100>,
    "title_alignment": <integer 0-100>
  },
  "matched_keywords": [<up to 10 keyword strings found in both resume and JD>],
  "missing_keywords": [<up to 10 important JD keywords absent from resume>],
  "suggestions": [<3-4 short actionable improvement strings>]
}

=== JOB ===
Role: ${job.role}
Company: ${job.company}
${desc}

=== RESUME ===
${resume}`;

  const proc = spawn('claude', ['--print', '--dangerously-skip-permissions', '--disable-slash-commands', '--safe-mode', '--tools', '', '--model', 'sonnet', '--no-session-persistence'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => err += d);
  proc.on('close', code => {
    if (code !== 0) return res.status(500).json({ ok: false, error: err.trim() || out.trim() });
    try {
      const match = out.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      const parsed = JSON.parse(match[0]);
      res.json({ ok: true, ...parsed });
    } catch {
      res.status(500).json({ ok: false, error: 'Claude returned an unexpected response.' });
    }
  });
  proc.stdin.write(prompt, 'utf8');
  proc.stdin.end();
});

// Secondary scorer: HackerRank's own Software Intern rubric (ported from the
// hiring-agent repo's roles/software_engineering_intern). Fixed rubric, not
// JD-dependent — scores the resume itself against open source / self
// projects / production / technical skills categories.
app.post('/api/hackerrank-score/:id', async (req, res) => {
  const job = (await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id])).rows[0];
  if (!job) return res.status(404).json({ error: 'not found' });

  let resume = job.tailored_resume_latex;
  if (!resume) {
    try { resume = fs.readFileSync(RESUME_PATH, 'utf8'); }
    catch { return res.status(400).json({ error: 'No resume saved. Please save your resume first.' }); }
  }
  if (!resume.trim()) return res.status(400).json({ error: 'Resume is empty. Please save your resume first.' });

  const prompt = hackerRankRubric.buildPrompt(resume);

  const proc = spawn('claude', ['--print', '--dangerously-skip-permissions', '--disable-slash-commands', '--safe-mode', '--tools', '', '--model', 'sonnet', '--no-session-persistence', '--append-system-prompt', hackerRankRubric.SYSTEM_MESSAGE], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => err += d);
  proc.on('close', code => {
    if (code !== 0) return res.status(500).json({ ok: false, error: err.trim() || out.trim() });
    try {
      const match = out.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      const parsed = JSON.parse(match[0]);

      let total = 0;
      const breakdown = hackerRankRubric.CATEGORIES.map(cat => {
        const raw = parsed.scores?.[cat.key] || { score: 0, max: cat.max, evidence: '' };
        const score = Math.max(0, Math.min(Number(raw.score) || 0, cat.max));
        total += score;
        return { ...cat, score, evidence: raw.evidence || '' };
      });
      const bonus = Math.max(0, Math.min(Number(parsed.bonus_points?.total) || 0, hackerRankRubric.BONUS_MAX));
      const deductions = Math.max(0, Number(parsed.deductions?.total) || 0);
      total = Math.max(
        hackerRankRubric.MIN_FINAL_SCORE,
        Math.min(total + bonus - deductions, hackerRankRubric.MAX_FINAL_SCORE)
      );

      res.json({
        ok: true,
        total,
        max_score: hackerRankRubric.MAX_SCORE,
        max_final_score: hackerRankRubric.MAX_FINAL_SCORE,
        breakdown,
        bonus_points: { total: bonus, breakdown: parsed.bonus_points?.breakdown || '' },
        deductions: { total: deductions, reasons: parsed.deductions?.reasons || '' },
        key_strengths: parsed.key_strengths || [],
        areas_for_improvement: parsed.areas_for_improvement || [],
      });
    } catch {
      res.status(500).json({ ok: false, error: 'Claude returned an unexpected response.' });
    }
  });
  proc.stdin.write(prompt, 'utf8');
  proc.stdin.end();
});

function resolveLatexBin() {
  const names = ['pdflatex', 'xelatex', 'lualatex'];

  for (const name of names) {
    try { require('child_process').execSync(`where ${name}`, { stdio: 'ignore' }); return name; } catch {}
  }

  const knownDirs = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
    'C:\\Users\\hp\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64',
    'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
    'C:\\Program Files\\MiKTeX 2.9\\miktex\\bin\\x64',
  ].filter(Boolean);

  for (const dir of knownDirs) {
    for (const name of names) {
      const exe = path.join(dir, `${name}.exe`);
      if (fs.existsSync(exe)) return exe;
    }
  }

  console.error('[pdf] No LaTeX compiler found. Checked PATH and these directories:', knownDirs);
  return null;
}

function compilePdfAndCountPages(latex) {
  const latexBin = resolveLatexBin();
  if (!latexBin) return { pages: null, attempted: false };

  const tmpName = `resume_check_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpDir = os.tmpdir();
  const texPath = path.join(tmpDir, `${tmpName}.tex`);
  const logPath = path.join(tmpDir, `${tmpName}.log`);
  const pdfPath = path.join(tmpDir, `${tmpName}.pdf`);
  fs.writeFileSync(texPath, latex, 'utf8');

  spawnSync(latexBin, ['-interaction=nonstopmode', '-output-directory', tmpDir, texPath]);

  let pages = null;
  let errorLine = null;
  try {
    // pdflatex wraps the log at ~80 columns, which can split "(N pages,"
    // across lines depending on filename length — strip newlines first.
    const log = fs.readFileSync(logPath, 'utf8').replace(/\n/g, '');
    const m = log.match(/Output written on .*?\((\d+) pages?,/);
    if (m) pages = parseInt(m[1], 10);
  } catch {}

  const compiled = fs.existsSync(pdfPath);
  if (!compiled) {
    try {
      const log = fs.readFileSync(logPath, 'utf8');
      const m = log.match(/^!.*$/m);
      if (m) errorLine = m[0];
    } catch {}
  }

  ['tex', 'pdf', 'aux', 'log', 'out'].forEach(ext => {
    try { fs.unlinkSync(path.join(tmpDir, `${tmpName}.${ext}`)); } catch {}
  });

  return { pages, attempted: true, compiled, errorLine };
}

function findBalancedBraceEnd(text, openBraceIdx) {
  let depth = 0;
  for (let i = openBraceIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findCommandBlocks(text, command) {
  const blocks = [];
  const re = new RegExp(`\\\\${command}\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const braceStart = text.indexOf('{', m.index);
    const braceEnd = findBalancedBraceEnd(text, braceStart);
    if (braceEnd === -1) break;
    blocks.push({ start: m.index, end: braceEnd + 1 });
  }
  return blocks;
}

// Claude-written rewrites often use em/en dashes and arrows that pdflatex's
// ligature/kerning tables turn into glyphs some ATS parsers can't decode
// (and multi-hyphen runs like "--"/"---" trigger the same ligature behavior).
// Normalize those to plain ASCII before compiling/saving.
function sanitizeForAts(text) {
  return text
    .replace(/[‒–—―−]/g, '-')
    .replace(/→/g, ' to ')
    .replace(/-{2,}/g, '-');
}

// Removes the last \resumeSubItem{...} bullet from the Achievements section
// (and any \vspace{} directly preceding it), so a tailored resume that
// overflows to a second page can be trimmed back down to one.
function removeLastAchievement(latex) {
  const sectionStart = latex.indexOf('\\section{Achievements}');
  if (sectionStart === -1) return { latex, removed: false };
  const nextSection = latex.indexOf('\\section{', sectionStart + 1);
  const sectionEnd = nextSection === -1 ? latex.length : nextSection;
  const sectionText = latex.slice(sectionStart, sectionEnd);

  const items = findCommandBlocks(sectionText, 'resumeSubItem');
  if (items.length === 0) return { latex, removed: false };

  const last = items[items.length - 1];
  let removeStart = last.start;
  const before = sectionText.slice(0, removeStart);
  const vspaceMatch = before.match(/\\vspace\{[^}]*\}\s*$/);
  if (vspaceMatch) removeStart -= vspaceMatch[0].length;

  let removeEnd = last.end;
  while (removeEnd < sectionText.length && /[ \t\r\n]/.test(sectionText[removeEnd])) removeEnd++;

  const newSectionText = sectionText.slice(0, removeStart) + sectionText.slice(removeEnd);
  const remaining = findCommandBlocks(newSectionText, 'resumeSubItem').length;
  const finalSectionText = remaining === 0 ? '' : newSectionText;

  return {
    latex: latex.slice(0, sectionStart) + finalSectionText + latex.slice(sectionEnd),
    removed: true,
    remaining,
  };
}

// Hard one-page guarantee: compiles the tailored resume, and if it overflows
// to a second page, trims Achievements bullets (last one first, then both)
// and recompiles until it fits — or reports that it still doesn't.
function enforceOnePage(latex) {
  let result = compilePdfAndCountPages(latex);
  if (result.attempted && !result.compiled) {
    return { latex, pages: null, note: null, compileFailed: true, errorLine: result.errorLine };
  }
  if (result.pages === null || result.pages <= 1) {
    return { latex, pages: result.pages, note: null };
  }

  let current = latex;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const trimmed = removeLastAchievement(current);
    if (!trimmed.removed) break;
    current = trimmed.latex;
    result = compilePdfAndCountPages(current);
    if (result.pages !== null && result.pages <= 1) {
      return {
        latex: current,
        pages: result.pages,
        note: attempt === 1
          ? 'Removed 1 achievement bullet to keep the resume to one page.'
          : 'Removed both achievement bullets to keep the resume to one page.',
      };
    }
  }

  return {
    latex: current,
    pages: result.pages,
    note: 'Resume still exceeds one page after trimming both achievement bullets — please trim manually.',
  };
}

app.post('/api/pdf', (req, res) => {
  const { latex, filename = 'tailored_resume' } = req.body;
  if (!latex) return res.status(400).json({ error: 'No LaTeX content provided' });

  const tmpDir = os.tmpdir();
  const tmpName = `resume_${Date.now()}`;
  const texPath = path.join(tmpDir, `${tmpName}.tex`);
  const pdfPath = path.join(tmpDir, `${tmpName}.pdf`);

  fs.writeFileSync(texPath, latex, 'utf8');

  const latexBin = resolveLatexBin();

  if (!latexBin) {
    try { fs.unlinkSync(texPath); } catch {}
    return res.status(500).json({ error: 'No LaTeX compiler found. Install MiKTeX from https://miktex.org/download and restart the server.' });
  }

  const proc = spawn(latexBin, ['-interaction=nonstopmode', '-output-directory', tmpDir, texPath]);
  let log = '';
  proc.stdout.on('data', d => log += d);
  proc.stderr.on('data', d => log += d);

  proc.on('close', code => {
    const cleanup = () => ['tex', 'pdf', 'aux', 'log'].forEach(ext => {
      try { fs.unlinkSync(path.join(tmpDir, `${tmpName}.${ext}`)); } catch {}
    });

    if (code === 0 && fs.existsSync(pdfPath)) {
      const pdf = fs.readFileSync(pdfPath);
      cleanup();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);
      res.send(pdf);
    } else {
      cleanup();
      const errorLine = log.split(/\r?\n/).find(l => l.startsWith('!'));
      res.status(500).json({
        error: errorLine
          ? `LaTeX compilation failed: ${errorLine.replace(/^!\s*/, '')}`
          : 'LaTeX compilation failed.',
        log,
      });
    }
  });

  proc.on('error', () => {
    try { fs.unlinkSync(texPath); } catch {}
    res.status(500).json({ error: 'pdflatex not found. Install MiKTeX (https://miktex.org) or TeX Live.' });
  });
});

app.post('/api/sync', async (req, res) => {
  await pool.query(`DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days' AND status IN ('to_ask', 'declined', 'not_interested')`);

  const script = path.join(__dirname, 'scraper', 'run_scraper.py');
  const proc = spawn('python', [script]);
  let out = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => out += d);
  proc.on('close', code => {
    if (code === 0) res.json({ ok: true, message: out.trim() });
    else res.status(500).json({ ok: false, message: out.trim() });
  });
});

app.delete('/api/jobs/:id', async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM jobs WHERE id = $1', [id]);
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Job Tracker running at http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
