require('dotenv').config();
const { chromium } = require('playwright');
const { postJob } = require('./lib/backend');
const { notifyNewJobs } = require('./lib/notify');
const { passesFilters } = require('./lib/filters');

// Same search terms as scraper/run_scraper.py's SEARCHES — kept in sync by
// hand, no shared source between the Python and Node scrapers.
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
];

const MAX_PAGES_PER_TERM = 2; // politeness — this is a real, watched browser, not a firehose

function pause(minMs, maxMs) {
  return new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

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

function jobRefId(url) {
  const m = /-(\d+)$/.exec((url || '').split('?')[0]);
  return m ? `nk-${m[1]}` : null;
}

async function main() {
  console.log(`=== Naukri scrape started ${new Date().toISOString()} ===`);

  // Headed, real Chrome — required. Headless gets an outright Akamai
  // "Access Denied"; this must run on a machine with a real desktop session
  // (Task Scheduler: "Run only when user is logged on", not "whether logged
  // on or not" — the latter has no display either).
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const page = await browser.newPage();

  const allAdded = [];
  let totalScraped = 0;
  let totalFiltered = 0;
  let totalSkipped = 0;

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
          const job = {
            company: card.company || 'Unknown',
            role: card.title,
            job_url: card.job_url,
            job_ref_id: jobRefId(card.job_url),
            status: 'to_ask',
            source: 'n8n',
            notes: `Auto-fetched · Naukri · ${card.location}`.replace(/ · $/, ''),
            description: card.description || null,
          };
          try {
            const added = await postJob(job);
            if (added) allAdded.push(job);
            else totalSkipped++;
          } catch (e) {
            console.warn(`Failed to post job: ${e.message}`);
          }
        }
      } catch (e) {
        console.error(`[naukri] page load failed for '${term}' page ${p}: ${e.message}`);
        break;
      }
      await pause(2000, 4000);
    }
    await pause(3000, 6000); // between search terms
  }

  console.log(`scraped=${totalScraped}, added=${allAdded.length}, dupes=${totalSkipped}, filtered=${totalFiltered}`);
  await notifyNewJobs(allAdded.map((j) => ({ company: j.company, role: j.role, job_url: j.job_url })));

  await browser.close();
  console.log(`=== Done. ${allAdded.length} new jobs added. ===`);
}

main().catch((e) => {
  console.error('Naukri scrape failed:', e);
  process.exitCode = 1;
});
