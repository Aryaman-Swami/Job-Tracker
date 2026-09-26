const { waitForEnter, pause } = require('../human');
const { uploadResumeGeneric } = require('../formfill');

function matches(host) {
  return /(^|\.)wellfound\.com$/i.test(host) || /(^|\.)angel\.co$/i.test(host);
}

async function ensureLoggedIn(page) {
  const loginLink = page.locator('a:has-text("Log in"), a:has-text("Sign in")').first();
  if (await loginLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await waitForEnter('Wellfound needs you to log in. Please sign in manually in this window, then continue.');
  }
}

// Wellfound's "quick apply" is typically a single click with no separate
// review page either — same handoff shape as Naukri, but there's no reliable
// standalone profile-resume page to pre-update, so we just try to attach the
// resume if a file input is already on screen and then stop.
async function run(page, ctx) {
  await ensureLoggedIn(page);
  await pause(800, 1500);
  await uploadResumeGeneric(page, ctx.resumePath).catch(() => false);
  console.log('\nWellfound\'s apply flow is usually a single, immediate click with no review step,');
  console.log('so please finish and submit this application yourself.');
  return 'handoff';
}

module.exports = { name: 'wellfound', matches, run };
