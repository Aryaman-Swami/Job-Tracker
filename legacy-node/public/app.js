const API = '/api/jobs';
const SOURCE = { AUTO: 'n8n', MANUAL: 'manual' };

let currentStatus = 'all';
let currentSource = SOURCE.AUTO;
let selectedJobId = null;
let currentSearch = '';
let currentNeedsReferral = false;
let currentSort = 'added_desc';
let currentJob = null;
let allJobs = [];

const modal    = document.getElementById('modal');
const jobForm  = document.getElementById('jobForm');
const jobList  = document.getElementById('jobList');
const modalTitle = document.getElementById('modalTitle');

function populateRoleDropdown(selectedRole = '') {
  const roleSelect = document.getElementById('role');
  const roleNew = document.getElementById('roleNew');
  const uniqueRoles = [...new Set(allJobs.filter(j => j.source === SOURCE.MANUAL).map(j => j.role).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  roleSelect.innerHTML = '';
  const placeholder = new Option('Select a role…', '', true, false);
  placeholder.disabled = true;
  roleSelect.add(placeholder);
  uniqueRoles.forEach(r => roleSelect.add(new Option(r, r)));
  roleSelect.add(new Option('+ Add new role…', '__new__'));

  if (selectedRole && uniqueRoles.includes(selectedRole)) {
    roleSelect.value = selectedRole;
    roleNew.style.display = 'none';
    roleNew.value = '';
    roleNew.required = false;
  } else if (selectedRole) {
    roleSelect.value = '__new__';
    roleNew.style.display = '';
    roleNew.value = selectedRole;
    roleNew.required = true;
  } else {
    roleSelect.value = '';
    roleNew.style.display = 'none';
    roleNew.value = '';
    roleNew.required = false;
  }
}

document.getElementById('role').addEventListener('change', e => {
  const roleNew = document.getElementById('roleNew');
  if (e.target.value === '__new__') {
    roleNew.style.display = '';
    roleNew.required = true;
    roleNew.focus();
  } else {
    roleNew.style.display = 'none';
    roleNew.required = false;
    roleNew.value = '';
  }
});

function openModal(job = null) {
  jobForm.reset();
  document.getElementById('jobId').value = job ? job.id : '';
  modalTitle.textContent = job ? 'Edit Job' : 'Add Job';
  populateRoleDropdown(job ? job.role : '');
  if (job) {
    document.getElementById('company').value      = job.company || '';
    document.getElementById('jobRefId').value     = job.job_ref_id || '';
    document.getElementById('contactName').value  = job.contact_name || '';
    document.getElementById('contactEmail').value = job.contact_email || '';
    document.getElementById('jobUrl').value       = job.job_url || '';
    document.getElementById('linkedinUrl').value  = job.linkedin_profile_url || '';
    document.getElementById('needsReferral').checked = job.needs_referral || false;
    document.getElementById('description').value  = job.description || '';
    document.getElementById('notes').value        = job.notes || '';
  }
  modal.classList.remove('hidden');
}

function closeModal() { modal.classList.add('hidden'); }

document.getElementById('openModal').addEventListener('click', () => openModal());

document.getElementById('searchInput').addEventListener('input', e => {
  currentSearch = e.target.value.trim().toLowerCase();
  renderJobs();
});

document.getElementById('sortSelect').addEventListener('change', e => {
  currentSort = e.target.value;
  renderJobs();
});

document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  btn.textContent = 'Syncing…';
  btn.disabled = true;
  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const data = await res.json();
    btn.textContent = data.ok ? '✓ Synced' : '✗ Failed';
    if (data.ok) loadJobs();
  } catch {
    btn.textContent = '✗ Failed';
  }
  setTimeout(() => { btn.textContent = '⟳ Sync'; btn.disabled = false; }, 2500);
});
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('cancelModal').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

const resumeModal = document.getElementById('resumeModal');
function openResumeModal() {
  fetch('/api/resume').then(r => r.json()).then(d => {
    document.getElementById('resumeContent').value = d.content || '';
    resumeModal.classList.remove('hidden');
  });
}
function closeResumeModal() { resumeModal.classList.add('hidden'); }
document.getElementById('resumeBtn').addEventListener('click', openResumeModal);
document.getElementById('closeResumeModal').addEventListener('click', closeResumeModal);
document.getElementById('cancelResumeModal').addEventListener('click', closeResumeModal);
resumeModal.addEventListener('click', e => { if (e.target === resumeModal) closeResumeModal(); });

document.getElementById('saveResumeBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveResumeBtn');
  const content = document.getElementById('resumeContent').value;
  btn.textContent = 'Saving…';
  btn.disabled = true;
  await fetch('/api/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  btn.textContent = 'Saved!';
  setTimeout(() => { btn.textContent = 'Save Resume'; btn.disabled = false; }, 1200);
});

document.getElementById('pdfBtnResume').addEventListener('click', async () => {
  const btn = document.getElementById('pdfBtnResume');
  const latex = document.getElementById('resumeContent').value;
  if (!latex) return;
  btn.textContent = 'Generating…';
  btn.disabled = true;
  try {
    const res = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex, filename: 'Aryaman_Swami_Resume' }),
    });
    if (res.ok) {
      const blob = await res.blob();
      closeResumeModal();
      openPdfPreview(blob, 'Aryaman_Swami_Resume.pdf', latex);
    } else {
      const data = await res.json();
      alert(data.error || 'PDF generation failed.');
    }
  } catch {
    alert('Request failed.');
  }
  btn.textContent = 'Generate PDF';
  btn.disabled = false;
});

function wireButtonGroup(selector, onActivate) {
  const btns = document.querySelectorAll(selector);
  btns.forEach(btn => btn.addEventListener('click', () => {
    btns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onActivate(btn);
  }));
}

wireButtonGroup('.tab-btn', btn => {
  currentSource = btn.dataset.source;
  selectJob(null);
  loadJobs();
});

wireButtonGroup('.filter-btn[data-status]', btn => {
  currentStatus = btn.dataset.status;
  loadJobs();
});

document.getElementById('needsReferralFilter').addEventListener('click', function() {
  currentNeedsReferral = !currentNeedsReferral;
  this.classList.toggle('active', currentNeedsReferral);
  loadJobs();
});

jobForm.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('jobId').value;
  const roleSelect = document.getElementById('role');
  const role = roleSelect.value === '__new__'
    ? document.getElementById('roleNew').value.trim()
    : roleSelect.value.trim();
  const body = {
    company:              document.getElementById('company').value.trim(),
    role,
    job_ref_id:           document.getElementById('jobRefId').value.trim() || null,
    contact_name:         document.getElementById('contactName').value.trim() || null,
    contact_email:        document.getElementById('contactEmail').value.trim() || null,
    job_url:              document.getElementById('jobUrl').value.trim() || null,
    linkedin_profile_url: document.getElementById('linkedinUrl').value.trim() || null,
    needs_referral:       document.getElementById('needsReferral').checked,
    description:          document.getElementById('description').value.trim() || null,
    notes:                document.getElementById('notes').value.trim() || null,
  };
  const url    = id ? `${API}/${id}` : API;
  const method = id ? 'PATCH' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  closeModal();
  loadJobs();
});

async function deleteJob(id, skipConfirm = false) {
  if (!skipConfirm && !confirm('Delete this job?')) return;
  await fetch(`${API}/${id}`, { method: 'DELETE' });
  if (selectedJobId === id) selectJob(null);
  loadJobs();
}

const STATUS_LABELS = { to_ask: 'To Ask', asked: 'Asked', applied: 'Applied', responded: 'Responded', declined: 'Declined', not_interested: 'Not Interested' };
const STATUS_OPTIONS = Object.entries(STATUS_LABELS);

function buildTemplate(job) {
  const name    = job.contact_name || 'Name';
  const role    = job.role || 'Role';
  const company = job.company || 'Company';
  const jobId   = job.job_ref_id || 'N/A';
  const jobLink = job.job_url || 'N/A';
  return `Hi ${name},

Quick ask — I'm applying for a ${role} role at ${company} and a referral from you would genuinely boost my chances. I've put in the work to make sure I'm a strong fit, and I'd really appreciate the nudge.

Role: ${role}
Job ID: ${jobId}

Resume: https://drive.google.com/file/d/1ZmZlLaCHrwik0zV5ZaaLJxRCctKuaFUv/view?usp=sharing

Job link: ${jobLink}
Email: swamiaryaman21.as@gmail.com

A reply would be helpful :)`;
}

function renderDetailRows(job) {
  const rows = [
    { label: 'Status',  value: `<span class="badge badge-${job.status}">${STATUS_LABELS[job.status] || job.status}</span>` },
    { label: 'Source',  value: job.source === SOURCE.AUTO ? 'Auto-fetched' : 'Manual' },
    { label: 'Added',   value: new Date(job.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
  ];
  rows.splice(-1, 0, { label: 'Posted', value: postedBadge(job) || 'Unknown' });
  if (job.contact_name)         rows.splice(1, 0, { label: 'Contact',  value: esc(job.contact_name) });
  if (job.contact_email)        rows.splice(2, 0, { label: 'Email',    value: `<a href="mailto:${esc(job.contact_email)}">${esc(job.contact_email)}</a>` });
  if (job.needs_referral)       rows.splice(1, 0, { label: 'Referral', value: '<span class="badge badge-referral">Needed</span>' });
  if (job.job_ref_id)           rows.splice(-2, 0, { label: 'Job ID',  value: esc(job.job_ref_id) });
  if (job.job_url)              rows.splice(-2, 0, { label: 'Link',    value: `<a href="${esc(job.job_url)}" target="_blank" rel="noopener">View Posting &#8599;</a>` });
  if (job.linkedin_profile_url) rows.splice(-2, 0, { label: 'LinkedIn',value: `<a href="${esc(job.linkedin_profile_url)}" target="_blank" rel="noopener">View Profile &#8599;</a>` });
  if (job.notes)                rows.splice(-1, 0, { label: 'Notes',   value: esc(job.notes) });

  return rows.map(r =>
    `<div class="detail-row"><span class="detail-label">${r.label}</span><span class="detail-value">${r.value}</span></div>`
  ).join('');
}

function selectJob(job) {
  selectedJobId = job ? job.id : null;
  document.querySelectorAll('.job-card').forEach(c => c.classList.remove('selected'));

  const empty   = document.getElementById('panelEmpty');
  const content = document.getElementById('panelContent');

  if (!job) {
    currentJob = null;
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }

  const card = document.querySelector(`.job-card[data-id="${job.id}"]`);
  if (card) card.classList.add('selected');

  currentJob = job;
  document.getElementById('panelTitle').textContent    = job.company;
  document.getElementById('panelSubtitle').textContent = job.role;
  document.getElementById('detailRows').innerHTML      = renderDetailRows(job);
  document.getElementById('templateText').textContent  = buildTemplate(job);
  document.getElementById('referralBox').classList.add('hidden');
  document.getElementById('linkedinBox').classList.add('hidden');
  document.getElementById('tailorBtn').textContent = '✨ Tailor Resume with Claude';
  document.getElementById('tailorBtn').disabled = false;
  if (job.tailored_resume_latex) {
    document.getElementById('tailorText').textContent = job.tailored_resume_latex;
    document.getElementById('tailorBox').classList.remove('hidden');
  } else {
    document.getElementById('tailorBox').classList.add('hidden');
  }
  document.getElementById('atsBox').classList.add('hidden');
  document.getElementById('atsBtn').textContent = '📊 ATS Score';
  document.getElementById('atsBtn').disabled = false;

  empty.classList.add('hidden');
  content.classList.remove('hidden');
}

document.getElementById('closePanel').addEventListener('click', () => selectJob(null));

document.getElementById('generateReferral').addEventListener('click', () => {
  document.getElementById('referralBox').classList.toggle('hidden');
});

document.getElementById('linkedinBtn').addEventListener('click', () => {
  if (!currentJob) return;
  const company = currentJob.company || '';
  const role = currentJob.role || '';
  const firstName = currentJob.contact_name ? currentJob.contact_name.split(' ')[0] : null;

  const query = currentJob.contact_name ? `${currentJob.contact_name} ${company}` : company;
  const url = currentJob.linkedin_profile_url
    ? currentJob.linkedin_profile_url
    : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;

  const greeting = firstName ? `Hi ${firstName}` : 'Hi';
  const note = `${greeting}, I'm applying for a ${role} role at ${company} and would love a referral if you think I'd be a good fit. Happy to share my resume!`;

  const btn = document.getElementById('linkedinSearchBtn');
  btn.href = url;
  btn.textContent = currentJob.linkedin_profile_url ? 'Open Profile' : 'Search LinkedIn';
  document.getElementById('linkedinText').textContent = note;
  document.getElementById('linkedinBox').classList.toggle('hidden');
});

document.getElementById('copyLinkedinBtn').addEventListener('click', () => {
  const text = document.getElementById('linkedinText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyLinkedinBtn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy Note'; btn.classList.remove('copied'); }, 2000);
  });
});

async function runTailor(atsFeedback) {
  const jobId = selectedJobId;
  const btn = document.getElementById('tailorBtn');

  const isStillActive = () => selectedJobId === jobId;
  if (isStillActive()) {
    document.getElementById('tailorBox').classList.add('hidden');
    btn.textContent = '⏳ Tailoring with Claude…';
    btn.disabled = true;
  }

  try {
    const res = await fetch(`/api/tailor/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(atsFeedback ? { atsFeedback } : {}),
    });
    const data = await res.json();
    if (data.ok) {
      const job = allJobs.find(j => j.id === jobId);
      if (job) job.tailored_resume_latex = data.latex;
      if (currentJob && currentJob.id === jobId) currentJob.tailored_resume_latex = data.latex;

      if (isStillActive()) {
        document.getElementById('tailorText').textContent = data.latex;
        document.getElementById('tailorBox').classList.remove('hidden');
        const noteEl = document.getElementById('tailorNote');
        if (data.note) {
          noteEl.textContent = `⚠ ${data.note}`;
          noteEl.classList.remove('hidden');
        } else {
          noteEl.classList.add('hidden');
        }
      }
    } else if (isStillActive()) {
      alert(data.error || 'Tailoring failed.');
    }
  } catch {
    if (isStillActive()) alert('Request failed.');
  }

  if (isStillActive()) {
    btn.textContent = '✨ Tailor Resume with Claude';
    btn.disabled = false;
  }
}

document.getElementById('tailorBtn').addEventListener('click', () => runTailor(null));

document.getElementById('copyTailorBtn').addEventListener('click', () => {
  const text = document.getElementById('tailorText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyTailorBtn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
});

let pdfObjectUrl = null;
let pdfFilename = 'Aryaman_Swami_Resume.pdf';

function buildResumeFilename(company) {
  const clean = (company || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Aryaman_Swami_Resume_${clean}.pdf`;
}

function openPdfPreview(blob, filename, latex) {
  if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
  pdfObjectUrl = URL.createObjectURL(blob);
  pdfFilename = filename;
  document.getElementById('pdfFrame').src = pdfObjectUrl;
  if (latex !== undefined) document.getElementById('pdfLatexEditor').value = latex;
  document.getElementById('pdfModal').classList.remove('hidden');
}

function closePdfPreview() {
  document.getElementById('pdfModal').classList.add('hidden');
  document.getElementById('pdfFrame').src = '';
  if (pdfObjectUrl) { URL.revokeObjectURL(pdfObjectUrl); pdfObjectUrl = null; }
}

document.getElementById('closePdfModal').addEventListener('click', closePdfPreview);
document.getElementById('pdfModal').addEventListener('click', e => {
  if (e.target === document.getElementById('pdfModal')) closePdfPreview();
});

document.getElementById('pdfModalDownload').addEventListener('click', () => {
  if (!pdfObjectUrl) return;
  const a = document.createElement('a');
  a.href = pdfObjectUrl;
  a.download = pdfFilename;
  a.click();
});

document.getElementById('pdfModalOpenTab').addEventListener('click', () => {
  if (!pdfObjectUrl) return;
  window.open(pdfObjectUrl, '_blank');
});

document.getElementById('pdfSaveBtn').addEventListener('click', async () => {
  const latex = document.getElementById('pdfLatexEditor').value;
  if (!latex || !selectedJobId) return;

  const btn = document.getElementById('pdfSaveBtn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  const baseName = buildResumeFilename(currentJob?.company).replace(/\.pdf$/, '');

  try {
    const [pdfRes, saveRes] = await Promise.all([
      fetch('/api/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex, filename: baseName }),
      }),
      fetch(`/api/tailor/${selectedJobId}/latex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex }),
      }),
    ]);

    if (pdfRes.ok) {
      const blob = await pdfRes.blob();
      if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
      pdfObjectUrl = URL.createObjectURL(blob);
      document.getElementById('pdfFrame').src = pdfObjectUrl;
    } else {
      const data = await pdfRes.json();
      alert(data.error || 'PDF recompilation failed.');
    }

    if (saveRes.ok) {
      document.getElementById('tailorText').textContent = latex;
      if (currentJob) currentJob.tailored_resume_latex = latex;
      btn.textContent = 'Saved!';
    } else {
      btn.textContent = 'Save & Recompile';
      alert('Saving the LaTeX failed.');
    }
  } catch {
    alert('Request failed.');
    btn.textContent = 'Save & Recompile';
  }

  setTimeout(() => { btn.textContent = 'Save & Recompile'; btn.disabled = false; }, 1500);
});

document.getElementById('pdfBtn').addEventListener('click', async () => {
  const latex = document.getElementById('tailorText').textContent;
  if (!latex) return;

  const btn = document.getElementById('pdfBtn');
  btn.textContent = 'Generating…';
  btn.disabled = true;

  const baseName = buildResumeFilename(currentJob?.company).replace(/\.pdf$/, '');

  try {
    const res = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex, filename: baseName }),
    });

    if (res.ok) {
      const blob = await res.blob();
      openPdfPreview(blob, `${baseName}.pdf`, latex);
      btn.textContent = 'Generate PDF';
    } else {
      const data = await res.json();
      // Auto-download .tex as fallback
      const blob = new Blob([latex], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.tex`;
      a.click();
      URL.revokeObjectURL(url);
      alert(`${data.error}\n\nDownloaded as .tex instead — you can compile it on Overleaf if needed.`);
      btn.textContent = 'Generate PDF';
    }
  } catch {
    alert('Request failed.');
    btn.textContent = 'Generate PDF';
  }

  btn.disabled = false;
});

let lastAtsResult = null;

async function runAtsScore() {
  const btn = document.getElementById('atsBtn');
  const box = document.getElementById('atsBox');
  const content = document.getElementById('atsContent');
  const jobId = selectedJobId;

  btn.textContent = '⏳ Analyzing…';
  btn.disabled = true;

  try {
    const res = await fetch(`/api/ats-score/${jobId}`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      lastAtsResult = { jobId, missing_keywords: data.missing_keywords || [], suggestions: data.suggestions || [] };
      content.innerHTML = renderAtsScore(data);
      box.classList.remove('hidden');
    } else {
      alert(data.error || 'ATS analysis failed.');
    }
  } catch {
    alert('Request failed.');
  }

  btn.textContent = '📊 ATS Score';
  btn.disabled = false;
}

document.getElementById('atsBtn').addEventListener('click', async () => {
  const box = document.getElementById('atsBox');
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  await runAtsScore();
});

document.getElementById('rerunAtsBtn').addEventListener('click', runAtsScore);

document.getElementById('applyAtsBtn').addEventListener('click', () => {
  if (!lastAtsResult || lastAtsResult.jobId !== selectedJobId) {
    alert('Run an ATS score for this job first.');
    return;
  }
  const extraInstructions = document.getElementById('atsExtraPrompt').value.trim();
  if (!lastAtsResult.missing_keywords.length && !lastAtsResult.suggestions.length && !extraInstructions) {
    alert('Nothing to apply — the last scan had no missing keywords or suggestions, and no additional instructions were entered.');
    return;
  }
  runTailor({
    missing_keywords: lastAtsResult.missing_keywords,
    suggestions: lastAtsResult.suggestions,
    extra_instructions: extraInstructions || undefined,
  });
});

async function runHackerRankScore() {
  const btn = document.getElementById('hrBtn');
  const box = document.getElementById('hrBox');
  const content = document.getElementById('hrContent');
  const jobId = selectedJobId;

  btn.textContent = '⏳ Analyzing…';
  btn.disabled = true;

  try {
    const res = await fetch(`/api/hackerrank-score/${jobId}`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      content.innerHTML = renderHackerRankScore(data);
      box.classList.remove('hidden');
    } else {
      alert(data.error || 'HackerRank scoring failed.');
    }
  } catch {
    alert('Request failed.');
  }

  btn.textContent = '🏆 HackerRank ATS Score';
  btn.disabled = false;
}

document.getElementById('hrBtn').addEventListener('click', async () => {
  const box = document.getElementById('hrBox');
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  await runHackerRankScore();
});

document.getElementById('rerunHrBtn').addEventListener('click', runHackerRankScore);

function renderHackerRankScore(data) {
  const { total, max_final_score, breakdown, bonus_points, deductions, key_strengths, areas_for_improvement } = data;
  const pct = Math.max(0, Math.min(100, (total / max_final_score) * 100));
  const color = pct >= 60 ? '#1a9455' : pct >= 35 ? '#d97706' : '#c0392b';
  const deg = pct * 3.6;

  const breakdownHtml = (breakdown || []).map(cat => {
    const val = cat.max ? Math.round((cat.score / cat.max) * 100) : 0;
    const cls = val >= 75 ? 'good' : val >= 50 ? 'ok' : 'bad';
    return `<div class="ats-row"><span class="ats-row-label">${cat.icon} ${esc(cat.label)}</span><div class="ats-track"><div class="ats-fill ${cls}" style="width:${val}%"></div></div><span class="ats-row-pct">${cat.score}/${cat.max}</span></div>`;
  }).join('');

  const evidenceHtml = (breakdown || []).map(cat =>
    `<li><strong>${cat.icon} ${esc(cat.label)}:</strong> ${esc(cat.evidence)}</li>`
  ).join('');

  const strengthsHtml = (key_strengths || []).map(s => `<li>${esc(s)}</li>`).join('');
  const improvementsHtml = (areas_for_improvement || []).map(s => `<li>${esc(s)}</li>`).join('');

  return `
    <div class="ats-score-ring">
      <div class="ats-score-circle" style="background:conic-gradient(${color} ${deg}deg,#f0f0f0 0deg)">
        <div class="ats-score-inner">
          <span class="ats-score-num" style="color:${color}">${total}</span>
          <span class="ats-score-denom">/${max_final_score}</span>
        </div>
      </div>
      <div class="ats-score-label">HackerRank Intern Rubric</div>
    </div>
    ${breakdownHtml ? `<div class="ats-breakdown">${breakdownHtml}</div>` : ''}
    ${bonus_points?.total || deductions?.total ? `<div class="ats-suggestions"><div class="ats-kw-title">Bonus / Deductions</div><ul>${bonus_points?.total ? `<li>+${bonus_points.total} bonus: ${esc(bonus_points.breakdown || '')}</li>` : ''}${deductions?.total ? `<li>-${deductions.total} deducted: ${esc(deductions.reasons || '')}</li>` : ''}</ul></div>` : ''}
    ${evidenceHtml ? `<div class="ats-suggestions"><div class="ats-kw-title">Evidence</div><ul>${evidenceHtml}</ul></div>` : ''}
    ${strengthsHtml ? `<div class="ats-suggestions"><div class="ats-kw-title">Key Strengths</div><ul>${strengthsHtml}</ul></div>` : ''}
    ${improvementsHtml ? `<div class="ats-suggestions"><div class="ats-kw-title">Areas for Improvement</div><ul>${improvementsHtml}</ul></div>` : ''}
  `;
}

function renderAtsScore(data) {
  const { score, breakdown, matched_keywords, missing_keywords, suggestions } = data;
  const color = score >= 75 ? '#1a9455' : score >= 50 ? '#d97706' : '#c0392b';
  const deg = score * 3.6;

  const breakdownLabels = { keywords: 'Keyword Match', skills: 'Skills Alignment', experience: 'Experience Fit', title_alignment: 'Role Alignment' };
  const breakdownHtml = Object.entries(breakdown || {}).map(([key, val]) => {
    const cls = val >= 75 ? 'good' : val >= 50 ? 'ok' : 'bad';
    return `<div class="ats-row"><span class="ats-row-label">${breakdownLabels[key] || key}</span><div class="ats-track"><div class="ats-fill ${cls}" style="width:${val}%"></div></div><span class="ats-row-pct">${val}</span></div>`;
  }).join('');

  const matchedHtml = (matched_keywords || []).map(k => `<span class="ats-chip match">${esc(k)}</span>`).join('');
  const missingHtml = (missing_keywords || []).map(k => `<span class="ats-chip miss">${esc(k)}</span>`).join('');
  const suggestionsHtml = (suggestions || []).map(s => `<li>${esc(s)}</li>`).join('');

  return `
    <div class="ats-score-ring">
      <div class="ats-score-circle" style="background:conic-gradient(${color} ${deg}deg,#f0f0f0 0deg)">
        <div class="ats-score-inner">
          <span class="ats-score-num" style="color:${color}">${score}</span>
          <span class="ats-score-denom">/100</span>
        </div>
      </div>
      <div class="ats-score-label">ATS Match Score</div>
    </div>
    ${breakdownHtml ? `<div class="ats-breakdown">${breakdownHtml}</div>` : ''}
    ${matchedHtml ? `<div class="ats-keywords"><div class="ats-kw-title">Matched</div><div class="ats-chips">${matchedHtml}</div></div>` : ''}
    ${missingHtml ? `<div class="ats-keywords"><div class="ats-kw-title">Missing</div><div class="ats-chips">${missingHtml}</div></div>` : ''}
    ${suggestionsHtml ? `<div class="ats-suggestions"><div class="ats-kw-title">Suggestions</div><ul>${suggestionsHtml}</ul></div>` : ''}
  `;
}

document.getElementById('copyBtn').addEventListener('click', () => {
  const text = document.getElementById('templateText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
});

function renderJob(job) {
  const card = document.createElement('div');
  card.className = 'job-card';
  card.dataset.id = job.id;
  if (job.id === selectedJobId) card.classList.add('selected');

  const meta = [
    job.contact_name          && `<span>&#128100; ${job.contact_name}</span>`,
    job.contact_email         && `<a href="mailto:${job.contact_email}">&#9993; ${job.contact_email}</a>`,
    job.job_url               && `<a href="${job.job_url}" target="_blank" rel="noopener">&#128279; Job Posting</a>`,
    job.linkedin_profile_url  && `<a href="${job.linkedin_profile_url}" target="_blank" rel="noopener">&#128100; LinkedIn</a>`,
  ].filter(Boolean).join('');

  const statusOptions = STATUS_OPTIONS.map(([val, label]) =>
    `<option value="${val}"${job.status === val ? ' selected' : ''}>${label}</option>`
  ).join('');

  card.innerHTML = `
    <div class="job-card-body">
      <div class="job-card-title">${esc(job.company)}${job.job_ref_id ? ` <span class="job-ref-id">#${esc(job.job_ref_id)}</span>` : ''}</div>
      <div class="job-card-sub">${esc(job.role)}</div>
      ${meta ? `<div class="job-card-meta">${meta}</div>` : ''}
      ${job.notes ? `<div class="job-notes">${esc(job.notes)}</div>` : ''}
    </div>
    <div class="job-card-actions">
      ${postedBadge(job)}
      ${job.needs_referral ? '<span class="badge badge-referral" title="Referral needed">Referral</span>' : ''}
      ${job.source === SOURCE.AUTO ? '<span class="badge badge-auto" title="Auto-fetched">Auto</span>' : ''}
      <select class="status-select status-${job.status}">${statusOptions}</select>
      ${job.job_url ? `<a class="apply-btn" href="${esc(job.job_url)}" target="_blank" rel="noopener">Apply</a>` : ''}
      <button class="icon-btn edit" title="Edit">&#9998;</button>
      <button class="icon-btn del" title="Delete">&#128465;</button>
    </div>
  `;
  card.querySelector('.edit').addEventListener('click', () => openModal(job));
  card.querySelector('.del').addEventListener('click', () => deleteJob(job.id));

  const statusSelect = card.querySelector('.status-select');
  statusSelect.addEventListener('change', async e => {
    e.stopPropagation();
    const newStatus = e.target.value;
    await fetch(`${API}/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (newStatus === 'not_interested') {
      if (selectedJobId === job.id) selectJob(null);
      loadJobs();
      return;
    }
    statusSelect.className = `status-select status-${newStatus}`;
    job.status = newStatus;
    if (selectedJobId === job.id) selectJob(job);
  });

  card.addEventListener('click', e => {
    if (e.target.closest('.icon-btn, .apply-btn, .status-select')) return;
    selectJob(job.id === selectedJobId ? null : job);
  });
  return card;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function postedBadge(job) {
  const exact = !!job.date_posted;
  const dateStr = job.date_posted || job.created_at;
  if (!dateStr) return '';
  const posted = new Date(dateStr);
  if (isNaN(posted)) return '';

  const hoursAgo = (Date.now() - posted.getTime()) / 36e5;
  const verb = exact ? 'Posted' : 'Scraped';
  const label = hoursAgo < 1
    ? (exact ? 'Just posted' : 'Just scraped')
    : hoursAgo < 24
      ? `${verb} ${Math.round(hoursAgo)}h ago`
      : `${verb} ${Math.round(hoursAgo / 24)}d ago`;

  const cls = hoursAgo < 12 ? 'badge-fresh' : 'badge-posted';
  const dateLabel = posted.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const title = exact ? dateLabel : `Exact posting date unavailable — showing scrape time instead: ${dateLabel}`;
  return `<span class="badge ${cls}" title="${title}">${label}</span>`;
}

function monthKey(dateStr) {
  return new Date(dateStr).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function postedTime(job) {
  const d = new Date(job.date_posted || job.created_at);
  return isNaN(d) ? 0 : d.getTime();
}

function renderJobs() {
  let jobs = currentSearch
    ? allJobs.filter(j => j.company.toLowerCase().includes(currentSearch))
    : allJobs.slice();

  jobList.innerHTML = '';
  if (!jobs.length) {
    jobList.innerHTML = '<div class="empty">No jobs here yet.</div>';
    return;
  }

  if (currentSort === 'posted_desc') {
    jobs = jobs.slice().sort((a, b) => postedTime(b) - postedTime(a));
  } else if (currentSort === 'posted_asc') {
    jobs = jobs.slice().sort((a, b) => postedTime(a) - postedTime(b));
  }

  if (currentSort !== 'added_desc') {
    const group = document.createElement('div');
    group.className = 'month-group';
    jobs.forEach(job => group.appendChild(renderJob(job)));
    jobList.appendChild(group);
    return;
  }

  const groups = [];
  const seen   = {};
  for (const job of jobs) {
    const key = monthKey(job.created_at);
    if (!seen[key]) { seen[key] = []; groups.push({ key, items: seen[key] }); }
    seen[key].push(job);
  }
  for (const { key, items } of groups) {
    const heading = document.createElement('div');
    heading.className = 'month-heading';
    heading.innerHTML = `<span>${key}</span><span class="month-count">${items.length}</span>`;
    jobList.appendChild(heading);
    const group = document.createElement('div');
    group.className = 'month-group';
    items.forEach(job => group.appendChild(renderJob(job)));
    jobList.appendChild(group);
  }
}

async function loadJobs() {
  const params = new URLSearchParams({ source: currentSource });
  if (currentStatus !== 'all') params.set('status', currentStatus);
  if (currentNeedsReferral) params.set('needs_referral', 'true');
  const res = await fetch(`${API}?${params}`);
  allJobs   = await res.json();
  renderJobs();
}

loadJobs();
