import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { SOURCE, STATUS_LABELS, postedShort, postedTime } from './utils.js';
import { isLoggedIn, logout } from './auth.js';
import { useMediaQuery } from './hooks.js';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import Toolbar from './components/Toolbar.jsx';
import PipelineStrip from './components/PipelineStrip.jsx';
import JobList from './components/JobList.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import JobFormModal from './components/JobFormModal.jsx';
import ResumeModal from './components/ResumeModal.jsx';
import PdfPreviewModal from './components/PdfPreviewModal.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import Login from './components/Login.jsx';

const DAYS_PER_PAGE = 3;
const VIEW_TITLES = { scraped: 'Scraped jobs', manual: 'Added by me' };

// Hash routes: #/jobs/scraped (default), #/jobs/manual, #/resume (opens the base resume over the last jobs view).
function routeFromHash() {
  const h = window.location.hash;
  if (h.startsWith('#/jobs/manual')) return 'manual';
  if (h.startsWith('#/resume')) return 'resume';
  return 'scraped';
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());

  useEffect(() => {
    function handleLogout() { setLoggedIn(false); }
    window.addEventListener('auth:logout', handleLogout);
    // Catches the token expiring while the tab is idle, not just on the next failed request.
    const interval = setInterval(() => { if (!isLoggedIn()) setLoggedIn(false); }, 30_000);
    return () => {
      window.removeEventListener('auth:logout', handleLogout);
      clearInterval(interval);
    };
  }, []);

  if (!loggedIn) return <Login onLoggedIn={() => setLoggedIn(true)} />;
  return <AuthedApp onLogout={() => { logout(); setLoggedIn(false); }} />;
}

function AuthedApp({ onLogout }) {
  const initialRoute = routeFromHash();
  const [view, setView] = useState(initialRoute === 'manual' ? 'manual' : 'scraped');
  const source = view === 'manual' ? SOURCE.MANUAL : SOURCE.AUTO;
  const [allJobs, setAllJobs] = useState([]);
  const [status, setStatus] = useState('all');
  const [searchRaw, setSearchRaw] = useState('');
  const search = searchRaw.trim().toLowerCase();
  const [sort, setSort] = useState('added_desc');
  const [needsReferral, setNeedsReferral] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);

  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [resumeModalOpen, setResumeModalOpen] = useState(initialRoute === 'resume');
  const [confirmJob, setConfirmJob] = useState(null);

  const [pdfPreview, setPdfPreview] = useState(null); // { blob, latex, filename, jobId, company }
  const [syncState, setSyncState] = useState('idle'); // idle | busy | done | failed
  const [lastSynced, setLastSynced] = useState(null);
  const [tailoringIds, setTailoringIds] = useState(() => new Set()); // job ids with a tailor call in flight
  const [tailorErrors, setTailorErrors] = useState({}); // job id -> message

  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [lastLoaded, setLastLoaded] = useState(null);

  const overlayDetail = useMediaQuery('(max-width: 899px)');
  const isFixture = document.documentElement.dataset.fixture === 'true';

  // Hash routing: the sidebar links are real destinations.
  useEffect(() => {
    function onHash() {
      const r = routeFromHash();
      if (r === 'resume') { setResumeModalOpen(true); return; }
      setView(v => {
        if (v !== r) { setSelectedJobId(null); setStatus('all'); }
        return r;
      });
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function closeResume() {
    setResumeModalOpen(false);
    if (routeFromHash() === 'resume') history.replaceState(null, '', `#/jobs/${view}`);
  }

  const baseParams = useCallback(() => {
    const params = { source, days: String(DAYS_PER_PAGE) };
    if (status !== 'all') params.status = status;
    if (needsReferral) params.needs_referral = 'true';
    if (search) params.search = search;
    return params;
  }, [source, status, needsReferral, search]);

  // Loads the newest page of days, replacing whatever was loaded.
  const loadJobs = useCallback(async () => {
    try {
      const page = await api.listJobsPage(baseParams());
      setAllJobs(page.jobs);
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
      setLoadError(false);
      setLastLoaded(new Date());
    } catch (e) {
      if (e.message !== 'Session expired' && e.message !== 'Not logged in') setLoadError(true);
    }
    setLoading(false);
  }, [baseParams]);

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { loadJobs(); }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadJobs, search]);

  function retryLoad() {
    setLoading(true);
    loadJobs();
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.listJobsPage({ ...baseParams(), before: nextBefore });
      setAllJobs(jobs => [...jobs, ...page.jobs]);
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const selectedJob = allJobs.find(j => j.id === selectedJobId) || null;

  function handleSelect(job) {
    setSelectedJobId(job.id);
  }

  function handleCloseDetail() {
    const id = selectedJobId;
    setSelectedJobId(null);
    requestAnimationFrame(() => document.querySelector(`.job-row[data-id="${id}"]`)?.focus());
  }

  async function handleSync() {
    setSyncState('busy');
    try {
      const data = await api.sync();
      setSyncState(data.ok ? 'done' : 'failed');
      if (data.ok) { setLastSynced(new Date()); loadJobs(); }
    } catch {
      setSyncState('failed');
    }
    setTimeout(() => setSyncState(s => (s === 'done' ? 'idle' : s)), 2500);
  }

  function openAddModal() {
    setEditingJob(null);
    setJobModalOpen(true);
  }

  function openEditModal(job) {
    setEditingJob(job);
    setJobModalOpen(true);
  }

  async function handleJobSubmit(body) {
    const { id, ...fields } = body;
    if (id) await api.updateJob(id, fields);
    else await api.createJob(fields);
    setJobModalOpen(false);
    loadJobs();
  }

  async function handleDeleteJob() {
    const job = confirmJob;
    await api.deleteJob(job.id);
    setConfirmJob(null);
    if (selectedJobId === job.id) setSelectedJobId(null);
    loadJobs();
  }

  async function handleStatusChange(job, newStatus) {
    await api.updateJob(job.id, { status: newStatus });
    if (newStatus === 'not_interested') {
      if (selectedJobId === job.id) setSelectedJobId(null);
      loadJobs();
      return;
    }
    setAllJobs(jobs => jobs.map(j => j.id === job.id ? { ...j, status: newStatus } : j));
  }

  function handleJobUpdated(id, patch) {
    setAllJobs(jobs => jobs.map(j => j.id === id ? { ...j, ...patch } : j));
  }

  // Tailoring state lives here (keyed by job id), not in DetailPanel, so several jobs
  // can be tailored at once and switching the selected job doesn't lose or block a run.
  async function handleTailor(jobId, atsFeedback) {
    setTailoringIds(ids => new Set(ids).add(jobId));
    setTailorErrors(errs => ({ ...errs, [jobId]: null }));
    try {
      const data = await api.tailor(jobId, atsFeedback);
      if (data.ok) {
        handleJobUpdated(jobId, {
          tailored_resume_latex: data.latex,
          tailored_skills_match: data.skillsMatch,
          _tailor_note: data.note || null,
        });
      } else {
        setTailorErrors(errs => ({ ...errs, [jobId]: data.error || 'Claude did not return a resume.' }));
      }
    } catch {
      setTailorErrors(errs => ({ ...errs, [jobId]: 'the request did not reach the server.' }));
    }
    setTailoringIds(ids => { const n = new Set(ids); n.delete(jobId); return n; });
  }

  function handleOpenPdfPreview(blob, filename, latex, jobId, company) {
    setPdfPreview({ blob, filename, latex, jobId, company });
  }

  function handleResumePdfGenerated(blob, filename, latex) {
    setPdfPreview({ blob, filename, latex, jobId: null, company: null });
  }

  function handlePdfSaved(latex) {
    if (pdfPreview?.jobId) handleJobUpdated(pdfPreview.jobId, { tailored_resume_latex: latex });
  }

  // ---- the finding under the title, computed from the rows in view ----
  const toAsk = allJobs.filter(j => j.status === 'to_ask');
  const oldestToAsk = toAsk.reduce((old, j) => (!old || postedTime(j) < postedTime(old) ? j : old), null);
  const toAskCount = status === 'all' || status === 'to_ask' ? toAsk.length : 0;

  function finding() {
    if (loading) return <span className="skeleton" aria-label="Loading" />;
    if (loadError) return <span>Couldn&apos;t load jobs.</span>;
    if (status !== 'all') {
      return (
        <>
          <span>{allJobs.length} {allJobs.length === 1 ? 'job' : 'jobs'} at {STATUS_LABELS[status].toLowerCase()}.</span>
          <button type="button" className="link-btn" onClick={() => setStatus('all')}>Show all stages</button>
        </>
      );
    }
    if (!allJobs.length) return <span>No jobs in the last {DAYS_PER_PAGE} days.</span>;
    if (!toAsk.length) return <span>Nothing left to ask a referral for in these {allJobs.length} jobs.</span>;
    const age = postedShort(oldestToAsk);
    return (
      <>
        <span>
          {toAsk.length} {toAsk.length === 1 ? 'job is' : 'jobs are'} still to ask for a referral
          {age ? `, the oldest posted ${age === 'Just now' ? 'just now' : `${age} ago`}` : ''}.
        </span>
        <button type="button" className="link-btn" onClick={() => setStatus('to_ask')}>Show them</button>
      </>
    );
  }

  const emptyText = needsReferral && status === 'all' && !search
    ? 'Nothing to ask for: no job here needs a referral.'
    : search
      ? `No company matches "${searchRaw.trim()}". Clear the search to see every job.`
      : status !== 'all'
        ? `No jobs at ${STATUS_LABELS[status].toLowerCase()} in these days.`
        : view === 'manual'
          ? 'No jobs added yet. Use Add job to record one you found yourself.'
          : `No jobs scraped in the last ${DAYS_PER_PAGE} days. Sync jobs to fetch new postings.`;

  const sidebarProps = {
    view,
    toAsk: view === 'scraped' ? toAskCount : 0,
    needsReferral,
    onToggleNeedsReferral: () => setNeedsReferral(v => !v),
    syncState,
    lastSynced,
    onSync: handleSync,
    onLogout,
  };

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Job Tracker"><Sidebar {...sidebarProps} /></aside>
      <Header onAdd={openAddModal} addPrimary={!selectedJob} sidebarProps={sidebarProps} />

      <main className="canvas">
        <div className="page-head">
          <div>
            <h1>{VIEW_TITLES[view]}{!loading && !loadError && <>{' '}<span className="h1-count">{allJobs.length}</span></>}</h1>
            <div className="finding">
              {finding()}
              {needsReferral && (
                <span className="filter-chip">Needs a referral
                  <button type="button" className="link-btn" onClick={() => setNeedsReferral(false)} aria-label="Clear the needs a referral filter">Clear</button>
                </span>
              )}
            </div>
          </div>
          <button type="button" className={`btn add-job${selectedJob ? '' : ' primary'}`} onClick={openAddModal}>Add job</button>
        </div>

        {isFixture && <p className="notice">Sample data. Start the backend to see your own jobs.</p>}

        <PipelineStrip jobs={allJobs} status={status} onStatusChange={setStatus} loading={loading} error={loadError} />

        <div className="workspace">
          <section className="panel list-card" aria-label="Jobs">
            <Toolbar search={searchRaw} onSearchChange={setSearchRaw} sort={sort} onSortChange={setSort}
              count={allJobs.length} loading={loading} />
            <JobList
              jobs={allJobs}
              sort={sort}
              loading={loading}
              error={loadError}
              lastLoaded={lastLoaded}
              onRetry={retryLoad}
              emptyText={emptyText}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              selectedJobId={selectedJobId}
              onSelect={handleSelect}
              tailoringIds={tailoringIds}
            />
          </section>

          <DetailPanel
            job={selectedJob}
            overlay={overlayDetail}
            onClose={handleCloseDetail}
            onJobUpdated={handleJobUpdated}
            tailoring={selectedJob ? tailoringIds.has(selectedJob.id) : false}
            tailorError={selectedJob ? tailorErrors[selectedJob.id] : null}
            onTailor={handleTailor}
            onOpenPdfPreview={handleOpenPdfPreview}
            onEdit={openEditModal}
            onDelete={job => setConfirmJob(job)}
            onStatusChange={handleStatusChange}
          />
        </div>
      </main>

      <JobFormModal
        open={jobModalOpen}
        job={editingJob}
        allJobs={allJobs}
        onClose={() => setJobModalOpen(false)}
        onSubmit={handleJobSubmit}
      />

      <ResumeModal
        open={resumeModalOpen}
        onClose={closeResume}
        onGeneratePdf={handleResumePdfGenerated}
      />

      <PdfPreviewModal
        open={!!pdfPreview}
        pdfBlob={pdfPreview?.blob}
        initialLatex={pdfPreview?.latex}
        filename={pdfPreview?.filename}
        jobId={pdfPreview?.jobId}
        company={pdfPreview?.company}
        onClose={() => setPdfPreview(null)}
        onSaved={handlePdfSaved}
      />

      <ConfirmDialog
        open={!!confirmJob}
        title={confirmJob ? `Delete ${confirmJob.company}?` : ''}
        body="This removes the job, its match score and its tailored resume. It cannot be undone."
        confirmLabel="Delete job"
        onConfirm={handleDeleteJob}
        onClose={() => setConfirmJob(null)}
      />
    </div>
  );
}
