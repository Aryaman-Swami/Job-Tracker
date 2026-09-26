// Node equivalent of scraper/notify.py, for the remote/headless flow — same
// ntfy.sh topic, same "no account, no signup" approach. Reads the topic from
// scraper/notify_config.json so there's one source of truth for it instead
// of a second copy of the secret-ish topic string.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'scraper', 'notify_config.json');

function topic() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).ntfy_topic;
  } catch {
    return null;
  }
}

async function notifyText(title, message, clickUrl) {
  const t = topic();
  if (!t) {
    console.warn('notify skipped: no ntfy_topic configured in scraper/notify_config.json');
    return;
  }
  try {
    await fetch(`https://ntfy.sh/${t}`, {
      method: 'POST',
      body: message,
      headers: {
        Title: title,
        Tags: 'briefcase',
        ...(clickUrl ? { Click: clickUrl } : {}),
      },
    });
  } catch (e) {
    console.warn('ntfy notification failed:', e.message);
  }
}

async function notifyWithScreenshot(title, message, screenshotBuffer, clickUrl) {
  const t = topic();
  if (!t) {
    console.warn('notify skipped: no ntfy_topic configured in scraper/notify_config.json');
    return;
  }
  try {
    await fetch(`https://ntfy.sh/${t}`, {
      method: 'POST',
      body: screenshotBuffer,
      headers: {
        Title: title,
        'X-Message': message,
        Filename: 'review.png',
        Tags: 'briefcase',
        ...(clickUrl ? { Click: clickUrl } : {}),
      },
    });
  } catch (e) {
    console.warn('ntfy notification (with screenshot) failed:', e.message);
  }
}

module.exports = { notifyText, notifyWithScreenshot };
