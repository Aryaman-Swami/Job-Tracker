import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { SOURCE } from './utils.js';
import Header from './components/Header.jsx';
import Toolbar from './components/Toolbar.jsx';
import JobList from './components/JobList.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import JobFormModal from './components/JobFormModal.jsx';
import ResumeModal from './components/ResumeModal.jsx';
import PdfPreviewModal from './components/PdfPreviewModal.jsx';

export default function App() {
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

  const loadJobs = useCallback(async () => {
    const params = { source };
    if (status !== 'all') params.status = status;
    if (needsReferral) params.needs_referral = 'true';
    const jobs = await api.listJobs(params);
    setAllJobs(jobs);
  }, [source, status, needsReferral]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

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
          search={search}
          sort={sort}
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
