// Scrapes the "Recommended jobs for you" page (default tab plus the other
// recommendation tabs) so those jobs go through the same filter + auto-apply
// path as search results.
const { pause } = require('./naukri-account');

const URL = 'https://www.naukri.com/mnjuser/recommendedjobs';
const TABS = ['Handpicked for you', 'Profile', 'Preferences', 'You might like'];

function scrapeTuples(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('article.jobTuple')).map((el) => {
      const a = el.querySelector('a.jt-title-link');
      const comp = el.querySelector('.companyWrapper button, .companyWrapper a');
      const exp = el.querySelector('li.experience span');
      const loc = el.querySelector('li.location span, li.locWdth span, li[class*="location"] span');
      const href = a?.getAttribute('href') || '';
      return {
        title: a?.getAttribute('title') || a?.textContent?.trim() || '',
        job_url: href.startsWith('http') ? href : href ? `https://www.naukri.com${href}` : '',
        company: comp?.getAttribute('title') || comp?.textContent?.trim() || '',
        experience: exp?.getAttribute('title') || exp?.textContent?.trim() || '',
        location: loc?.getAttribute('title') || loc?.textContent?.trim() || '',
        description: el.querySelector('.job-description, .job-desc-text')?.textContent?.trim() || '',
      };
    })
  );
}

async function scrapeRecommended(page) {
  const byUrl = new Map();
  const collect = async () => {
    // Lazy-loaded list: scroll to the bottom a few times.
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 4000).catch(() => {});
      await pause(600, 1000);
    }
    for (const c of await scrapeTuples(page)) if (c.job_url) byUrl.set(c.job_url, c);
  };
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pause(4000, 6000);
    await collect();
    for (const tab of TABS) {
      const t = page.locator(`text=/^\s*${tab}\s*\(\d+\)/`).first();
      if (!(await t.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await t.click().catch(() => {});
      await pause(2500, 4000);
      await collect();
    }
  } catch (e) {
    console.error(`[naukri] recommended jobs scrape failed: ${e.message}`);
  }
  return Array.from(byUrl.values());
}

module.exports = { scrapeRecommended };
