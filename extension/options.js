const FIELDS = [
  ['backendUrl', 'Backend URL (http://localhost:3000 or your Render URL)'],
  ['username', 'Backend username'], ['password', 'Backend password', 'password'],
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
  ['linkedin', 'LinkedIn URL'], ['github', 'GitHub URL'], ['website', 'Website / portfolio'],
  ['location', 'City / location'], ['currentCompany', 'Current company'],
  ['workdayEmail', 'Workday account email (blank = Email)'], ['workdayPassword', 'Workday account password', 'password'],
  ['dailyCap', 'Max applications per day', 'number'], ['minAts', 'Skip jobs with ATS score below (0 = no filter)', 'number'],
];
const form = document.getElementById('form');
for (const [k, label, type = 'text'] of FIELDS) {
  form.insertAdjacentHTML('beforeend', `<label>${label}</label><input id="${k}" type="${type}">`);
}
form.insertAdjacentHTML('beforeend',
  `<label>Screening answers (JSON — first regex matching the question wins)</label>
   <textarea id="answers" placeholder='[{"match":"sponsor","answer":"No"},{"match":"authorized to work","answer":"Yes"},{"match":"notice period","answer":"30 days"}]'></textarea>
   <label>Work experience (JSON array: title, company, location, current, from "MM/YYYY", to "MM/YYYY", description)</label>
   <textarea id="experience" placeholder='[]'></textarea>
   <label>Education (JSON array: school, degree, field, gpa, from "YYYY", to "YYYY")</label>
   <textarea id="education" placeholder='[]'></textarea>
   <label><input type="checkbox" id="autoSubmit"> Auto-submit (otherwise fill only, then leave tab for review)</label>`);

chrome.storage.local.get('settings').then(({ settings: s = {} }) => {
  for (const [k] of FIELDS) if (s[k] != null) document.getElementById(k).value = s[k];
  document.getElementById('answers').value = s.answers ?? '[]';
  document.getElementById('experience').value = s.experience ?? '[]';
  document.getElementById('education').value = s.education ?? '[]';
  document.getElementById('autoSubmit').checked = s.autoSubmit ?? false;
});
document.getElementById('save').onclick = async () => {
  const s = {};
  for (const [k, , t] of FIELDS) { const v = document.getElementById(k).value; s[k] = t === 'number' ? Number(v) || 0 : v; }
  s.answers = document.getElementById('answers').value || '[]';
  s.experience = document.getElementById('experience').value || '[]';
  s.education = document.getElementById('education').value || '[]';
  for (const k of ['answers', 'experience', 'education']) {
    try { JSON.parse(s[k]); } catch { return (document.getElementById('msg').textContent = `${k} JSON is invalid`); }
  }
  s.autoSubmit = document.getElementById('autoSubmit').checked;
  await chrome.storage.local.set({ settings: s });
  await chrome.runtime.sendMessage({ type: 'resetToken' });
  document.getElementById('msg').textContent = 'Saved';
};
