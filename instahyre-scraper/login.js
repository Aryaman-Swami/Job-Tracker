// One-time (or when the session expires): opens Instahyre, you log in by hand,
// the session is saved to sessions/instahyre.json.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const SESSION = path.join(__dirname, 'sessions', 'instahyre.json');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await browser.newContext(fs.existsSync(SESSION) ? { storageState: SESSION } : {});
  const page = await ctx.newPage();
  await page.goto('https://www.instahyre.com/candidate/opportunities/?matching=true');
  console.log('Log in to Instahyre in the opened window (waiting up to 10 min)...');
  await page.waitForURL((u) => u.pathname.startsWith('/candidate/opportunities'), { timeout: 600000 });
  await page.waitForTimeout(5000);
  await ctx.storageState({ path: SESSION });
  console.log('Session saved to', SESSION);
  await browser.close();
})();
