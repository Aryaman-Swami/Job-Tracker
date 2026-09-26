require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { notifyNewJobs } = require('./lib/notify');
const { passesFilters } = require('./lib/filters');
const { ensureLoggedIn, updateProfileResume, pause } = require('./lib/naukri-account');
const seen = require('./lib/seen');

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
            continue;
          }
          seenUrls.add(card.job_url);
          newQualifying.push({ company: card.company || 'Unknown', role: card.title, job_url: card.job_url, location: card.location });
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

  if (newQualifying.length > 0) {
    // Getting these "ready to apply" means: your account is logged in (or
    // you're asked to, right here, right now) and your profile resume is
    // current — the Apply click itself stays yours, since Naukri submits
    // immediately with no review step to safely automate past.
    await ensureLoggedIn(page);
    await context.storageState({ path: SESSION_PATH });
    await updateProfileResume(page);
    await notifyNewJobs(newQualifying);
    seen.save(seenUrls);
  }

  await browser.close();
  console.log(`=== Done. ${newQualifying.length} job(s) ready for you to apply to on Naukri. ===`);
}

main().catch((e) => {
  console.error('Naukri scrape failed:', e);
  process.exitCode = 1;
});
