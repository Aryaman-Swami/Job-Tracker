// Runs on supported ATS pages. Does nothing unless the background worker says
// this tab is the one it opened for the current queued job.
(async () => {
  if (window.top !== window) return;
  const task = await chrome.runtime.sendMessage({ type: 'getTask' }).catch(() => null);
  if (!task) return;
  if (window.__jtApplyRunning) return;
  window.__jtApplyRunning = true;

  const { job, settings: S, resume } = task;
  const host = location.hostname;
  const ats = /myworkdayjobs/.test(host) ? 'workday' : /lever\.co/.test(host) ? 'lever'
    : /ashbyhq/.test(host) ? 'ashby' : 'greenhouse';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (a = 400, b = 900) => sleep(a + Math.random() * (b - a));
  const done = (outcome, detail) => chrome.runtime.sendMessage({ type: 'result', result: { outcome, detail } });

  // ---------- profile / answers ----------
  let custom = [];
  try { custom = JSON.parse(S.answers || '[]'); } catch { /* ignore bad JSON */ }
  const fullName = `${S.firstName} ${S.lastName}`.trim();
  const rules = [
    [/first\s*name|given name|preferred first/, S.firstName],
    [/last\s*name|family name|surname/, S.lastName],
    [/e-?mail/, ats === 'workday' ? (S.workdayEmail || S.email) : S.email],
    [/phone|mobile|contact number/, S.phone],
    [/linkedin/, S.linkedin],
    [/github/, S.github],
    [/website|portfolio|personal (site|url)/, S.website],
    [/current (company|employer)|most recent (company|employer)/, S.currentCompany],
    [/\b(city|location|where are you based)\b/, S.location],
    [/^(full |legal |your )?name\b/, fullName],
  ];
  function answerFor(label) {
    const l = label.toLowerCase();
    for (const c of custom) if (c.match && new RegExp(c.match, 'i').test(l)) return String(c.answer);
    for (const [re, v] of rules) if (v && re.test(l)) return v;
    return null;
  }

  // ---------- DOM helpers ----------
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  function labelOf(el) {
    const parts = [];
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) parts.push(lb.split(/\s+/).map((id) => text(document.getElementById(id))).join(' '));
    if (el.id) parts.push(text(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)));
    parts.push(text(el.closest('label')));
    if (!parts.join('').trim()) {
      const box = el.closest('fieldset, [class*="field"], [class*="question"], [data-automation-id^="formField"], li, .form-group');
      const l = box?.querySelector('label, legend, [class*="label"]');
      if (l) parts.push(text(l));
    }
    parts.push(el.placeholder || '', el.name || '');
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const isRequired = (el) =>
    el.required || el.getAttribute('aria-required') === 'true' ||
    /\*|required/i.test(el.closest('[class*="field"], [class*="question"], fieldset')?.querySelector('label, legend')?.textContent || '');

  // ---------- generic filling ----------
  async function fillFields() {
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter((el) => {
      if (['hidden', 'file', 'submit', 'button', 'password', 'checkbox', 'radio'].includes(el.type)) return false;
      return visible(el);
    });
    for (const el of inputs) {
      const label = labelOf(el);
      if (el instanceof HTMLSelectElement) {
        const ans = answerFor(label);
        if (ans && !el.value) {
          const opt = [...el.options].find((o) => o.text.toLowerCase().includes(ans.toLowerCase()));
          if (opt) setValue(el, opt.value);
        }
        continue;
      }
      if (el.value && el.value.trim()) continue; // never clobber prefilled values
      const ans = answerFor(label);
      if (ans) { el.focus(); setValue(el, ans); await jitter(120, 300); }
    }

    // radio groups
    const groups = {};
    document.querySelectorAll('input[type=radio]').forEach((r) => { if (visible(r)) (groups[r.name] ||= []).push(r); });
    for (const radios of Object.values(groups)) {
      if (radios.some((r) => r.checked)) continue;
      const q = text(radios[0].closest('fieldset, [class*="question"], [class*="field"]')?.querySelector('legend, label, [class*="label"]'));
      const ans = answerFor(q);
      if (!ans) continue;
      const pick = radios.find((r) => labelOf(r).toLowerCase().includes(ans.toLowerCase()));
      if (pick) pick.click();
    }

    // consent checkboxes
    document.querySelectorAll('input[type=checkbox]').forEach((c) => {
      if (!visible(c) || c.checked) return;
      if (/agree|acknowledge|consent|certify|privacy|terms/i.test(labelOf(c)) && isRequired(c)) c.click();
    });
  }

  async function uploadResume() {
    if (!resume || window.__jtUploaded) return;
    const files = [...document.querySelectorAll('input[type=file]')];
    const input = files.find((i) => /resume|cv/i.test(labelOf(i) + i.name + i.id + (i.getAttribute('data-automation-id') || ''))) || files[0];
    if (!input) return;
    const bin = atob(resume.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], resume.name, { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window.__jtUploaded = true;
    await sleep(2500);
  }

  // Workday custom dropdowns (button[aria-haspopup=listbox])
  async function fillWorkdayDropdowns() {
    const btns = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].filter(visible);
    for (const b of btns) {
      if (!/select one/i.test(b.textContent)) continue;
      const label = labelOf(b);
      const ans = answerFor(label) || (/country/i.test(label) ? 'India' : /phone device/i.test(label) ? 'Mobile' : null);
      if (!ans) continue;
      b.click(); await sleep(500);
      const opt = [...document.querySelectorAll('[role="option"]')]
        .find((o) => text(o).toLowerCase().includes(ans.toLowerCase()));
      if (opt) { opt.click(); await sleep(300); } else b.click();
    }
  }

  // ---------- required-field audit ----------
  function unfilledRequired() {
    const bad = [];
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      if (['hidden', 'submit', 'button', 'checkbox'].includes(el.type) || !visible(el) && el.type !== 'file') return;
      if (!isRequired(el)) return;
      if (el.type === 'file') { if (!el.files.length && !document.querySelector('[data-automation-id="file-upload-successful"]')) bad.push(labelOf(el)); return; }
      if (el.type === 'radio') {
        if (!document.querySelector(`input[type=radio][name="${CSS.escape(el.name)}"]:checked`)) bad.push(labelOf(el));
        return;
      }
      if (!el.value || !el.value.trim()) bad.push(labelOf(el));
    });
    document.querySelectorAll('button[aria-haspopup="listbox"]').forEach((b) => {
      if (visible(b) && /select one/i.test(b.textContent) && isRequired(b)) bad.push(labelOf(b));
    });
    return [...new Set(bad.map((s) => s.slice(0, 80)))];
  }

  // ---------- success / blocked detection ----------
  const SUCCESS = /(application (has been )?(submitted|received)|thank you for (applying|your application)|successfully (submitted|applied)|we('| ha)ve received your application)/i;
  const BLOCKED = /(captcha|verify you are human|are you a robot)/i;
  const succeeded = () => SUCCESS.test(document.body.innerText.slice(0, 6000));

  function findButton(re) {
    return [...document.querySelectorAll('button, input[type=submit], a[role=button]')]
      .find((b) => visible(b) && !b.disabled && re.test((b.value || text(b)).trim()));
  }

  // ---------- per-ATS flows ----------
  async function startIfNeeded() {
    if (ats === 'lever' && !location.pathname.endsWith('/apply')) {
      const a = [...document.querySelectorAll('a')].find((x) => /\/apply(\?|$)/.test(x.href));
      if (a) { location.href = a.href; return true; }
    }
    if (ats === 'ashby' && !/\/application/.test(location.pathname) && !document.querySelector('input[type=file]')) {
      const a = [...document.querySelectorAll('a')].find((x) => /\/application/.test(x.href));
      if (a) { location.href = a.href; return true; }
    }
    return false;
  }

  async function runSimple() {
    for (let pass = 0; pass < 3; pass++) {
      await fillFields(); await uploadResume(); await jitter(800, 1500);
    }
    const missing = unfilledRequired();
    if (missing.length) return done('needs_input', `unanswered: ${missing.slice(0, 6).join(' | ')}`);
    if (document.body.innerText.match(BLOCKED) && document.querySelector('iframe[src*="captcha"], .h-captcha')) {
      // visible captcha challenge — hand off to a human
      if (!S.autoSubmit) return done('needs_input', 'captcha present');
    }
    if (!S.autoSubmit) return done('needs_input', 'filled; auto-submit disabled — review and submit');
    const btn = findButton(/^submit( application)?$/i);
    if (!btn) return done('error', 'submit button not found');
    await jitter(1200, 2500);
    btn.click();
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      if (succeeded()) return done('applied', ats);
      const err = missingAfterSubmit();
      if (err) return done('needs_input', err);
    }
    return done('error', 'no confirmation after submit (captcha or validation?)');
  }

  function missingAfterSubmit() {
    const errs = [...document.querySelectorAll('[role=alert], [class*="error"]')].filter(visible).map(text).filter(Boolean);
    return errs.length ? `validation: ${errs.slice(0, 3).join(' | ').slice(0, 200)}` : null;
  }

  // ---------- Workday: Work Experience / Education (My Experience step) ----------
  // Data comes from Settings (S.experience / S.education, JSON arrays). Never invents data.
  const nativeSet = (el, v) => { el.focus(); setValue(el, v); };
  const byLabel = (root, re) => [...root.querySelectorAll('input, textarea')]
    .find((el) => !['hidden', 'file', 'checkbox', 'radio'].includes(el.type) && re.test(labelOf(el)));

  // Workday date segments: MM / YYYY (or just YYYY). Fill from the group, in DOM order.
  async function fillDate(root, which, value) {
    if (!value) return;
    const [mm, yyyy] = String(value).includes('/') ? String(value).split('/') : [null, String(value)];
    const months = [...root.querySelectorAll('[data-automation-id="dateSectionMonth-input"]')];
    const years = [...root.querySelectorAll('[data-automation-id="dateSectionYear-input"]')];
    if (mm && months[which]) { nativeSet(months[which], mm.padStart(2, '0')); await sleep(150); }
    if (yyyy && years[which]) { nativeSet(years[which], yyyy); await sleep(150); }
  }

  async function pickListbox(btn, wanted) {
    if (!btn || !wanted) return;
    btn.click(); await sleep(600);
    const opt = [...document.querySelectorAll('[role="option"]')]
      .find((o) => text(o).toLowerCase().includes(String(wanted).toLowerCase()));
    if (opt) { opt.click(); await sleep(300); } else btn.click();
  }

  function entryGroups(prefix, headingRe) {
    let g = [...document.querySelectorAll(`[data-automation-id^="${prefix}-"]`)]
      .filter((e) => e.querySelector('input, textarea, button[aria-haspopup="listbox"]'));
    if (g.length) return g;
    return [...document.querySelectorAll('h3, h4, legend')].filter((h) => headingRe.test(text(h)))
      .map((h) => h.closest('[role=group], fieldset, section') || h.parentElement?.parentElement).filter(Boolean);
  }

  async function ensureEntries(sectionRe, prefix, headingRe, count) {
    const sectionHead = [...document.querySelectorAll('h2, h3')].find((h) => sectionRe.test(text(h)));
    const sectionRoot = sectionHead?.closest('[data-automation-id], section, div') && sectionHead.parentElement;
    for (let guard = 0; guard < count + 2 && entryGroups(prefix, headingRe).length < count; guard++) {
      const scope = sectionRoot || document;
      const add = [...scope.querySelectorAll('button')].find((b) => visible(b) && /^add( another)?$/i.test(text(b)));
      if (!add) break;
      add.click(); await sleep(1500);
    }
    return entryGroups(prefix, headingRe);
  }

  async function fillWorkdayExperience() {
    if (window.__jtExpDone || !/my experience/i.test(text(document.querySelector('h2')))) return;
    let exp = [], edu = [];
    try { exp = JSON.parse(S.experience || '[]'); edu = JSON.parse(S.education || '[]'); } catch { /* bad JSON: skip */ }

    const works = await ensureEntries(/^work experience$/i, 'workExperience', /^work experience \d+/i, exp.length);
    for (let i = 0; i < Math.min(exp.length, works.length); i++) {
      const g = works[i], e = exp[i];
      const title = byLabel(g, /job title/i); if (title && !title.value) nativeSet(title, e.title);
      const co = byLabel(g, /company/i); if (co && !co.value) nativeSet(co, e.company);
      const loc = byLabel(g, /location/i); if (loc && !loc.value) nativeSet(loc, e.location || '');
      const cur = [...g.querySelectorAll('input[type=checkbox]')].find((c) => /currently work/i.test(labelOf(c)));
      if (cur && !!e.current !== cur.checked) { cur.click(); await sleep(500); }
      await fillDate(g, 0, e.from);
      if (!e.current) await fillDate(g, 1, e.to);
      const desc = [...g.querySelectorAll('textarea')][0]; if (desc && e.description && !desc.value) nativeSet(desc, e.description);
      await jitter(300, 600);
    }

    const schools = await ensureEntries(/^education$/i, 'education', /^education \d+/i, edu.length);
    for (let i = 0; i < Math.min(edu.length, schools.length); i++) {
      const g = schools[i], e = edu[i];
      const sc = byLabel(g, /school|university|institution/i); if (sc && !sc.value) nativeSet(sc, e.school);
      const deg = [...g.querySelectorAll('button[aria-haspopup="listbox"]')].find((b) => /degree/i.test(labelOf(b)));
      await pickListbox(deg, e.degree);
      const fos = byLabel(g, /field of study/i);
      if (fos && e.field) {
        fos.focus(); setValue(fos, e.field); await sleep(400);
        fos.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(1200);
        const opt = document.querySelector('[role="option"]'); if (opt) { opt.click(); await sleep(300); }
      }
      const gpa = byLabel(g, /gpa|overall result/i); if (gpa && e.gpa && !gpa.value) nativeSet(gpa, e.gpa);
      const years = [...g.querySelectorAll('[data-automation-id="dateSectionYear-input"]')];
      if (years[0] && e.from) nativeSet(years[0], String(e.from));
      if (years[1] && e.to) nativeSet(years[1], String(e.to));
      await jitter(300, 600);
    }
    window.__jtExpDone = true;
  }

  async function runWorkday() {
    const q = (id) => document.querySelector(`[data-automation-id="${id}"]`);
    const click = async (el) => { el.click(); await jitter(1200, 2200); };
    let stuck = 0, lastSig = '';

    for (let step = 0; step < 30; step++) {
      await sleep(1500);
      if (succeeded()) return done('applied', 'workday');

      // job page: choose manual apply
      const start = q('applyManually') || q('adventureButton') || findButton(/^apply( now)?$/i);
      if (start && visible(start)) { await click(start); continue; }
      const manual = q('applyManually'); if (manual && visible(manual)) { await click(manual); continue; }

      // account gate
      if (q('signInContent') || (q('email') && q('password'))) {
        const email = S.workdayEmail || S.email;
        const sign = q('signInSubmitButton') || q('click_filter');
        if (q('verifyPassword')) { // create-account form
          setValue(q('email'), email); setValue(q('password'), S.workdayPassword); setValue(q('verifyPassword'), S.workdayPassword);
          const cb = q('createAccountCheckbox'); if (cb && !cb.checked) cb.click();
          const create = q('createAccountSubmitButton') || q('click_filter'); if (create) await click(create);
        } else if (q('email') && q('password')) {
          setValue(q('email'), email); setValue(q('password'), S.workdayPassword);
          if (sign) await click(sign);
          await sleep(2500);
          if (q('email') && q('password') && !q('verifyPassword')) {
            const link = q('createAccountLink'); if (link) await click(link); else return done('needs_input', 'workday login failed');
          }
        }
        continue;
      }

      await fillWorkdayExperience();
      await fillFields(); await fillWorkdayDropdowns(); await uploadResume();
      await jitter(800, 1400);

      const submit = q('pageFooterSubmitButton') || findButton(/^submit$/i);
      if (submit && visible(submit)) {
        if (!S.autoSubmit) return done('needs_input', 'reached review; auto-submit disabled');
        await click(submit);
        for (let i = 0; i < 12; i++) { await sleep(1500); if (succeeded()) return done('applied', 'workday'); }
        return done('error', 'workday: no confirmation after submit');
      }

      const missing = unfilledRequired();
      if (missing.length) return done('needs_input', `unanswered: ${missing.slice(0, 6).join(' | ')}`);

      const next = q('pageFooterNextButton') || q('bottom-navigation-next-button');
      if (!next) return done('error', 'workday: no Next button');
      const sig = location.href + document.querySelector('h2')?.textContent;
      stuck = sig === lastSig ? stuck + 1 : 0; lastSig = sig;
      if (stuck > 2) return done('needs_input', `workday: stuck on "${document.querySelector('h2')?.textContent || 'a step'}"`);
      await click(next);
    }
    return done('error', 'workday: step limit reached');
  }

  // ---------- go ----------
  try {
    await sleep(1500);
    if (document.body.innerText.slice(0, 3000).match(/job (is )?no longer (available|accepting)|position (has been )?filled|page not found|404/i)) {
      return done('error', 'posting closed / not found');
    }
    if (ats === 'workday') return await runWorkday();
    if (await startIfNeeded()) return; // page navigates; script re-runs on the next page
    return await runSimple();
  } catch (e) {
    return done('error', e.message);
  }
})();
