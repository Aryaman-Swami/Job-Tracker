// Page-level Naukri apply logic, shared by:
//   - apply-bot/lib/adapters/naukri.js   (single job, triggered from the UI)
//   - naukri-scraper/scrape.js           (batch: every job the search returns)
// It only depends on a Playwright `page` + ./human, so both can require it.
//
// Outcomes (string):
//   applied          clicked Apply (and finished the chatbot questionnaire if any)
//   already_applied  Naukri already shows "Applied" for this job
//   external         only "Apply on company site" exists -> not auto-applied
//   expired          posting closed / removed
//   needs_input      chatbot asked something we have no configured answer for
//   session_expired  Naukri wants a login
//   limit_reached    Naukri daily apply limit hit (caller should stop the batch)
//   error            anything unexpected (caller may retry later)

const fs = require('fs');
const path = require('path');
const { pause } = require('./human');

const SUCCESS_TEXT = /(successfully applied|applied successfully|application (has been )?(sent|submitted)|you have applied|your application has been)/i;
const LIMIT_TEXT = /(daily (apply )?limit|limit (of|for) .*applications?|reached .*limit)/i;
const EXPIRED_TEXT = /(no longer accepting|job (has )?expired|job is no longer|position (has been )?closed|this job (is )?(not available|closed))/i;

const SEL = {
  apply: '#apply-button, button.apply-button, button:text-is("Apply"), button:text-is("Apply Now")',
  loginToApply: 'button:has-text("Login to Apply"), button:has-text("Login to apply"), #login_Layer',
  company: '#company-site-button, button:has-text("Apply on company site")',
  already: '#already-applied, button:text-is("Applied"), .already-applied',
  drawer: '[class*="chatbot_DrawerContentWrapper"], [id^="chatbot_Drawer"], [class*="chatbot_Drawer"], .chatbot_MessageContainer',
  botMsg: '[class*="botMsg"], .botItem, [class*="chatbot_MessageContainer"] .botMsg',
  textInput: '[class*="chatbot_InputContainer"] [contenteditable="true"], .textArea[contenteditable="true"], [id^="chatbot_Drawer"] input[type="text"], [class*="chatbot_Drawer"] input[type="text"]',
  send: '.sendMsg, [class*="sendMsg"], button:text-is("Save"), button:text-is("Submit"), button:text-is("Send"), button:text-is("Next")',
  chip: '[class*="chatbot_Chip"], .ssrc__label, [class*="ssrc__radio-btn-container"] label, [class*="singleselect"] label',
};

// ---- configurable questionnaire answers --------------------------------
// apply-bot/naukri-answers.json: { "rules": [ { "match": "regex", "answer": "text" }, ... ] }
// First matching rule wins. For chip/radio questions the answer is matched
// against option labels (case-insensitive substring). Anything that matches no
// rule is NOT guessed at -> 'needs_input'.
function loadAnswers() {
  const defaults = [
    { match: 'notice period|joining|how soon|when can you join', answer: process.env.NAUKRI_NOTICE_PERIOD || '' },
    { match: 'current ctc|current salary|current compensation', answer: process.env.NAUKRI_CURRENT_CTC || '' },
    { match: 'expected ctc|expected salary|expected compensation', answer: process.env.NAUKRI_EXPECTED_CTC || '' },
    { match: 'total experience|years of experience|how many years|experience in', answer: process.env.NAUKRI_EXPERIENCE_YEARS || '' },
    { match: 'current location|current city|where are you (currently )?(based|located)', answer: process.env.NAUKRI_CURRENT_CITY || '' },
    { match: 'relocat|willing to|comfortable|ready to|open to|available for', answer: 'Yes' },
    { match: 'phone|mobile|contact number', answer: process.env.CANDIDATE_PHONE || '' },
    { match: 'e-?mail', answer: process.env.CANDIDATE_EMAIL || '' },
  ].filter((r) => r.answer);
  let custom = [];
  try {
    const file = process.env.NAUKRI_ANSWERS_FILE || path.join(__dirname, '..', 'naukri-answers.json');
    custom = JSON.parse(fs.readFileSync(file, 'utf8')).rules || [];
  } catch {}
  return [...custom, ...defaults]; // user rules take precedence
}

// Questions the chatbot asked that no rule answered (for the user to configure).
const unanswered = new Map(); // question -> options[]
function noteUnanswered(q, options = []) {
  if (q) unanswered.set(q.slice(0, 300), options);
}

function answerFor(question, rules) {
  for (const r of rules) {
    try {
      if (new RegExp(r.match, 'i').test(question)) return String(r.answer);
    } catch {}
  }
  return null;
}

// ---- helpers ------------------------------------------------------------
const visible = (page, sel, t = 1500) => page.locator(sel).first().isVisible({ timeout: t }).catch(() => false);
const bodyText = (page) => page.evaluate(() => document.body.innerText).catch(() => '');

async function needsLogin(page) {
  if (/nlogin|login\.naukri|\/login/i.test(page.url())) return true;
  return visible(page, SEL.loginToApply, 800);
}

async function classifyPage(page) {
  const text = await bodyText(page);
  if (EXPIRED_TEXT.test(text)) return 'expired';
  return null;
}

async function detectState(page) {
  if (/saveApply|myapply|applyconfirm/i.test(page.url())) return 'success';
  if (await visible(page, SEL.already, 300)) return 'success';
  if (await visible(page, SEL.drawer, 300)) return 'chatbot';
  const text = await bodyText(page);
  if (LIMIT_TEXT.test(text)) return 'limit';
  if (SUCCESS_TEXT.test(text)) return 'success';
  if (await needsLogin(page)) return 'login';
  return null;
}

async function waitForState(page, ms = 9000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await detectState(page);
    if (s) return s;
    await pause(400, 700);
  }
  return null;
}

async function lastBotQuestion(page) {
  return page
    .evaluate((sel) => {
      const els = Array.from(document.querySelectorAll(sel));
      return (els.length ? els[els.length - 1].innerText : '').trim();
    }, SEL.botMsg)
    .catch(() => '');
}

async function closeDrawer(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await pause(300, 600);
}

// Walk the chatbot questionnaire. Returns 'success' | 'needs_input' | 'limit' | 'error'.
async function runChatbot(page, log, maxSteps = 25) {
  const rules = loadAnswers();
  let lastQ = '';
  let repeats = 0;
  for (let step = 0; step < maxSteps; step++) {
    await pause(1200, 2200); // bot "types" its next message
    const state = await detectState(page);
    if (state === 'success') return 'success';
    if (state === 'limit') return 'limit';
    if (state === 'login') return 'login';

    const q = await lastBotQuestion(page);
    if (q && q === lastQ) {
      if (++repeats >= 3) {
        log(`chatbot stuck on: "${q.slice(0, 80)}"`);
        return 'needs_input';
      }
    } else {
      repeats = 0;
      lastQ = q;
    }

    const answer = answerFor(q, rules);
    const chips = page.locator(SEL.chip);
    const chipCount = await chips.count().catch(() => 0);
    const input = page.locator(SEL.textInput).first();
    const hasInput = await input.isVisible({ timeout: 800 }).catch(() => false);

    if (chipCount > 0 && !hasInput) {
      // single/multi choice
      if (answer === null) {
        noteUnanswered(q, await chips.allInnerTexts().catch(() => []));
        log(`no configured answer for choice question: "${q.slice(0, 100)}"`);
        return 'needs_input';
      }
      let clicked = false;
      for (let i = 0; i < chipCount; i++) {
        const label = (await chips.nth(i).innerText().catch(() => '')).trim();
        if (label && label.toLowerCase().includes(answer.toLowerCase())) {
          await chips.nth(i).click().catch(() => {});
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        noteUnanswered(q, await chips.allInnerTexts().catch(() => []));
        log(`answer "${answer}" not among options for: "${q.slice(0, 100)}"`);
        return 'needs_input';
      }
    } else if (hasInput) {
      if (answer === null || answer === '') {
        noteUnanswered(q);
        log(`no configured answer for question: "${q.slice(0, 100)}"`);
        return 'needs_input';
      }
      await input.click().catch(() => {});
      await pause(200, 400);
      await page.keyboard.type(answer, { delay: 40 + Math.random() * 50 });
    } else {
      continue; // nothing actionable yet — bot still typing
    }

    await pause(500, 1000);
    const send = page.locator(SEL.send).first();
    if (await send.isVisible({ timeout: 1500 }).catch(() => false)) await send.click().catch(() => {});
    else await page.keyboard.press('Enter').catch(() => {});
  }
  return 'error';
}

// Core: apply on an already-loaded Naukri job page. `log` is optional.
async function applyOnJobPage(page, log = () => {}) {
  await pause(1200, 2000);

  if (await needsLogin(page)) return 'session_expired';
  const cls = await classifyPage(page);
  if (cls === 'expired') return 'expired';
  if (await visible(page, SEL.already, 1500)) return 'already_applied';

  const applyBtn = page.locator(SEL.apply).first();
  const hasApply = await applyBtn.isVisible({ timeout: 6000 }).catch(() => false);
  if (!hasApply) {
    if (await visible(page, SEL.company, 1500)) return 'external';
    if (await needsLogin(page)) return 'session_expired';
    return (await classifyPage(page)) || 'error';
  }
  const btnText = ((await applyBtn.innerText().catch(() => '')) || '').toLowerCase();
  if (btnText.includes('login') || btnText.includes('register')) return 'session_expired';

  await applyBtn.scrollIntoViewIfNeeded().catch(() => {});
  await pause(500, 1100);
  await applyBtn.click();

  const state = await waitForState(page);
  if (state === 'success') return 'applied';
  if (state === 'limit') return 'limit_reached';
  if (state === 'login') return 'session_expired';
  if (state === 'chatbot') {
    const r = await runChatbot(page, log);
    if (r === 'success') return 'applied';
    if (r === 'limit') return 'limit_reached';
    if (r === 'login') return 'session_expired';
    await closeDrawer(page);
    return r === 'needs_input' ? 'needs_input' : 'error';
  }
  // Possibly opened an external tab / nothing happened.
  if (await visible(page, SEL.already, 1500)) return 'applied';
  return 'error';
}

// Navigate then apply, with one retry on transient navigation failures.
async function applyToUrl(page, url, log = () => {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return await applyOnJobPage(page, log);
    } catch (e) {
      log(`navigation/apply error (attempt ${attempt + 1}): ${e.message}`);
      if (/closed/i.test(e.message)) return 'error';
      await pause(2000, 4000);
    }
  }
  return 'error';
}

// Quick check that the saved session is still logged in.
async function isLoggedIn(page) {
  await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await pause(1500, 2500);
  if (/nlogin|login/i.test(page.url())) return false;
  return !(await visible(page, '#login_Layer', 1500));
}

module.exports = { applyOnJobPage, applyToUrl, isLoggedIn, loadAnswers, answerFor, unanswered };
