import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { SOURCE } from './utils.js';
import { isLoggedIn, logout } from './auth.js';
import Header from './components/Header.jsx';
import Toolbar from './components/Toolbar.jsx';
import JobList from './components/JobList.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import JobFormModal from './components/JobFormModal.jsx';
import ResumeModal from './components/ResumeModal.jsx';
import PdfPreviewModal from './components/PdfPreviewModal.jsx';
import Login from './components/Login.jsx';

const DAYS_PER_PAGE = 3;

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
  const [allJobs, setAllJobs] = useState([]);
  const [source, setSource] = useState(SOURCE.AUTO);
  const [status, setStatus] = useState('all');
  const [searchRaw, setSearchRaw] = useState('');
  const search = searchRaw.trim().toLowerCase();
  const [sort, setSort] = useState('added_desc');
  const [needsReferral, setNeedsReferral] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);

  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);

  const [pdfPreview, setPdfPreview] = useState(null); // { blob, latex, filename, jobId, company }
  const [syncLabel, setSyncLabel] = useState('⟳ Sync');
  const [syncing, setSyncing] = useState(false);
  const [tailoringIds, setTailoringIds] = useState(() => new Set()); // job ids with a tailor call in flight

  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const baseParams = useCallback(() => {
    const params = { source, days: String(DAYS_PER_PAGE) };
    if (status !== 'all') params.status = status;
    if (needsReferral) params.needs_referral = 'true';
    if (search) params.search = search;
    return params;
  }, [source, status, needsReferral, search]);

  // Loads the newest page of days, replacing whatever was loaded.
  const loadJobs = useCallback(async () => {
    const page = await api.listJobsPage(baseParams());
    setAllJobs(page.jobs);
    setHasMore(page.hasMore);
    setNextBefore(page.nextBefore);
    setLoading(false);
  }, [baseParams]);

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { loadJobs(); }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadJobs, search]);

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.listJobsPage({ ...baseParams(), before: nextBefore });
      setAllJobs(jobs => [...jobs, ...page.jobs]);
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  }

  const selectedJob = allJobs.find(j => j.id === selectedJobId) || null;

  function handleSelect(job) {
    setSelectedJobId(job ? job.id : null);
  }

  function handleSourceChange(newSource) {
    setSource(newSource);
    setSelectedJobId(null);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncLabel('Syncing…');
    try {
      const data = await api.sync();
      setSyncLabel(data.ok ? '✓ Synced' : '✗ Failed');
      if (data.ok) loadJobs();
    } catch {
      setSyncLabel('✗ Failed');
    }
    setTimeout(() => { setSyncLabel('⟳ Sync'); setSyncing(false); }, 2500);
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

  async function handleDeleteJob(id) {
    if (!confirm('Delete this job?')) return;
    await api.deleteJob(id);
    if (selectedJobId === id) setSelectedJobId(null);
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
    try {
      const data = await api.tailor(jobId, atsFeedback);
      if (data.ok) {
        handleJobUpdated(jobId, {
          tailored_resume_latex: data.latex,
          tailored_skills_match: data.skillsMatch,
          _tailor_note: data.note || null,
        });
      } else {
        alert(data.error || 'Tailoring failed.');
      }
    } catch {
      alert('Request failed.');
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

  return (
    <div className="container">
      <Header
        onResume={() => setResumeModalOpen(true)}
        onSync={handleSync}
        onAdd={openAddModal}
        onLogout={onLogout}
        syncing={syncing}
        syncLabel={syncLabel}
      />

      <Toolbar
        source={source} onSourceChange={handleSourceChange}
        search={searchRaw} onSearchChange={setSearchRaw}
        sort={sort} onSortChange={setSort}
        status={status} onStatusChange={setStatus}
        needsReferral={needsReferral} onToggleNeedsReferral={() => setNeedsReferral(v => !v)}
      />

      <div className="main-layout">
        <JobList
          jobs={allJobs}
          sort={sort}
          loading={loading}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          selectedJobId={selectedJobId}
          onSelect={handleSelect}
          onEdit={openEditModal}
          onDelete={handleDeleteJob}
          onStatusChange={handleStatusChange}
        />

        <DetailPanel
          job={selectedJob}
          onClose={() => setSelectedJobId(null)}
          onJobUpdated={handleJobUpdated}
          tailoring={selectedJob ? tailoringIds.has(selectedJob.id) : false}
          onTailor={handleTailor}
          onOpenPdfPreview={handleOpenPdfPreview}
        />
      </div>

      <JobFormModal
        open={jobModalOpen}
        job={editingJob}
        allJobs={allJobs}
        onClose={() => setJobModalOpen(false)}
        onSubmit={handleJobSubmit}
      />

      <ResumeModal
        open={resumeModalOpen}
        onClose={() => setResumeModalOpen(false)}
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
    </div>
  );
}
