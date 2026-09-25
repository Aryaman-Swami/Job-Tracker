// Small helpers that keep the automation paced like a person clicking through
// a form, rather than a script firing actions instantly. This is about not
// being obnoxious to the site (and not tripping naive rate-based bot checks
// on your own account) — it is not fingerprint spoofing or CAPTCHA evasion.

function randomDelay(minMs, maxMs) {
  return minMs + Math.random() * (maxMs - minMs);
}

async function pause(minMs = 400, maxMs = 1100) {
  await new Promise((r) => setTimeout(r, randomDelay(minMs, maxMs)));
}

async function typeLikeHuman(locator, text) {
  await locator.click();
  await pause(150, 350);
  await locator.pressSequentially(text, { delay: 35 + Math.random() * 60 });
}

async function waitForEnter(promptText) {
  console.log(`\n>>> ${promptText}\n>>> Press Enter in this terminal once done...`);
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

module.exports = { pause, typeLikeHuman, waitForEnter };
