const { typeLikeHuman, pause } = require('./human');

async function fillFirst(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
      const current = await loc.inputValue().catch(() => '');
      if (current && current.trim()) return true; // don't clobber a pre-filled field
      await typeLikeHuman(loc, value);
      await pause(200, 500);
      return true;
    }
  }
  return false;
}

async function uploadResumeGeneric(page, resumePath) {
  const input = page.locator('input[type="file"]').first();
  const count = await page.locator('input[type="file"]').count();
  if (count === 0) return false;
  await input.setInputFiles(resumePath);
  await pause(1000, 1800);
  return true;
}

// Generic ARIA-based required-field check, shared across the non-Workday
// adapters (Workday keeps its own copy — same idea, don't touch working code).
async function hasUnfilledRequiredFields(page) {
  const requiredInputs = page.locator('[aria-required="true"], [required]');
  const total = await requiredInputs.count();
  for (let i = 0; i < total; i++) {
    const el = requiredInputs.nth(i);
    const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => '');
    if (tag === 'input' || tag === 'textarea') {
      const value = await el.inputValue().catch(() => '');
      if (!value || !value.trim()) return true;
    }
  }
  return false;
}

module.exports = { fillFirst, uploadResumeGeneric, hasUnfilledRequiredFields };
