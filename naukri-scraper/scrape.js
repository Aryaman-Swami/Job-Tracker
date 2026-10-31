require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { notifyNewJobs } = require('./lib/notify');
const { passesFilters } = require('./lib/filters');
const { ensureLoggedIn, updateProfileResume, pause } = require('./lib/naukri-account');
const seen = require('./lib/seen');
const autoApply = require('./lib/auto-apply');
const applyStore = require('./lib/apply-store');

const SESSION_PATH = path.join(__dirname, 'sessions', 'naukri.json');

// Java terms (same as scraper/run_scraper.py) plus Node.js-worded terms —
// broadening MUST_CONTAIN in filters.js to accept Node roles doesn't surface
// any if nothing here ever searches for them.
const SEARCH_TERMS = [
  'java developer 2 years experience',
  'java developer 1 year experience',
  'junior java developer',
  'java developer entry level',
  'SDE 1 java',
  'SDE-1 java',
  'associate software engineer java',
  'java software engineer',
  'java programmer',
  'java spring boot developer',
  'java microservices developer',
  'java backend engineer',
  'java rest api developer',
  'node js developer 2 years experience',
  'node js backend developer',
  'nodejs developer',
];

const MAX_PAGES_PER_TERM = 2; // politeness — this is a real, watched browser, not a firehose

function searchUrl(term, page) {
  const q = encodeURIComponent(term);
  return `https://www.naukri.com/${term.replace(/\s+/g, '-').toLowerCase()}-jobs-in-india?k=${q}&pageNo=${page}`;
}

// Card descriptions are a short truncated snippet (often empty) — not
// enough to trust for the java/node MUST_CONTAIN check or to catch an
// abroad posting whose location field lists an Indian city but whose JD
// body says otherwise. Fetch the full JD from the job's own page before
// any job is accepted as qualifying.
async function fetchFullDescription(context, url) {
  const detail = await context.newPage();
  try {
    await detail.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pause(1200, 2000);
    return await detail.evaluate(() => {
      const el =
        document.querySelector('.styles_JDC__dang-inner-html') ||
        document.querySelector('[class*="dang-inner-html"]') ||
        document.querySelector('[class*="job-desc"]') ||
        document.querySelector('.job-desc');
      return el?.textContent?.trim() || '';
    });
  } catch (e) {
    console.error(`[naukri] full description fetch failed for ${url}: ${e.message}`);
    return '';
  } finally {
    await detail.close();
  }
}

async function scrapeCards(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.cust-job-tuple'));
    return cards.map((el) => {
      const titleEl = el.querySelector('h2 a.title');
      const companyEl = el.querySelector('a.comp-name');
      const expEl = el.querySelector('.exp-wrap .expwdth');
      const locEl = el.querySelector('.loc-wrap .locWdth');
      const descEl = el.querySelector('.job-desc');
      return {
        title: titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || '',
        job_url: titleEl?.getAttribute('href') || '',
        company: companyEl?.getAttribute('title') || companyEl?.textContent?.trim() || '',
        experience: expEl?.getAttribute('title') || expEl?.textContent?.trim() || '',
        location: locEl?.getAttribute('title') || locEl?.textContent?.trim() || '',
        description: descEl?.textContent?.trim() || '',
      };
    });
  });
}

async function main() {
  console.log(`=== Naukri scrape started ${new Date().toISOString()} ===`);

  // Headed, real Chrome — required. Headless gets an outright Akamai
  // "Access Denied"; this must run on a machine with a real desktop session
  // (Task Scheduler: "Run only when user is logged on", not "whether logged
  // on or not" — the latter has no display either).
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  const hasSession = fs.existsSync(SESSION_PATH);
  const context = await browser.newContext(hasSession ? { storageState: SESSION_PATH } : {});
  const page = await context.newPage();

  const seenUrls = seen.load();
  const newQualifying = [];
  const applyCandidates = new Map(); // url -> job; every qualifying job, new or previously seen
  const applyLedger = applyStore.load();
  const botOn = await autoApply.botActive();
  console.log(`auto-apply: ${botOn ? 'ON' : 'off (NAUKRI_AUTO_APPLY=0)'}`);
  let totalScraped = 0;
  let totalFiltered = 0;
  let totalAlreadySeen = 0;

  for (const term of SEARCH_TERMS) {
    for (let p = 1; p <= MAX_PAGES_PER_TERM; p++) {
      try {
        await page.goto(searchUrl(term, p), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await pause(2500, 4000);

        const cards = await scrapeCards(page);
        if (cards.length === 0) break; // no more pages for this term
        totalScraped += cards.length;

        for (const card of cards) {
          if (!card.job_url || !passesFilters(card)) {
            totalFiltered++;
            continue;
          }
          if (seenUrls.has(card.job_url)) {
            totalAlreadySeen++;
            // Seen != applied: still attempt anything the ledger hasn't finished.
            if (botOn && applyStore.needsAttempt(applyLedger, card.job_url)) {
              applyCandidates.set(card.job_url, { company: card.company || 'Unknown', role: card.title, job_url: card.job_url, location: card.location });
            }
            continue;
          }

          // Confirm against the full JD before accepting — the card-level
          // snippet already passed, but a full description can still reveal
          // an abroad posting or fail the java/node check on closer look.
          card.description = await fetchFullDescription(context, card.job_url);
          await pause(800, 1500);
          if (!passesFilters(card)) {
            totalFiltered++;
            continue;
          }

          seenUrls.add(card.job_url);
          const job = { company: card.company || 'Unknown', role: card.title, job_url: card.job_url, location: card.location };
          newQualifying.push(job);
          applyCandidates.set(card.job_url, job);
        }
      } catch (e) {
        console.error(`[naukri] page load failed for '${term}' page ${p}: ${e.message}`);
        break;
      }
      await pause(2000, 4000);
    }
    await pause(3000, 6000); // between search terms
  }

  console.log(`scraped=${totalScraped}, new_qualifying=${newQualifying.length}, already_seen=${totalAlreadySeen}, filtered=${totalFiltered}`);

  if (newQualifying.length > 0 || (botOn && applyCandidates.size > 0)) {
    // Getting these "ready to apply" means: your account is logged in (or
    // you're asked to, right here, right now) and your profile resume is
    // current — the Apply click itself stays yours, since Naukri submits
    // immediately with no review step to safely automate past.
    await ensureLoggedIn(page);
    await context.storageState({ path: SESSION_PATH });
    await updateProfileResume(page);
    await notifyNewJobs(newQualifying);
    seen.save(seenUrls);
    if (botOn) {
      const summary = await autoApply.applyAll(page, Array.from(applyCandidates.values()), context);
      console.log('auto-apply summary:', JSON.stringify(summary));
      await context.storageState({ path: SESSION_PATH }).catch(() => {});
    }
  }

  await browser.close();
  console.log(`=== Done. ${newQualifying.length} job(s) ready for you to apply to on Naukri. ===`);
}

main().catch((e) => {
  console.error('Naukri scrape failed:', e);
  process.exitCode = 1;
});
