import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useDialog } from '../hooks.js';

export default function ResumeModal({ open, onClose, onGeneratePdf }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useDialog(open, onClose);

  useEffect(() => {
    if (!open) return;
    setError(null); setSaveState('idle'); setLoading(true);
    api.getResume()
      .then(d => setContent(d.content || ''))
      .catch(() => setError('Could not load your base resume. Try opening it again.'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaveState('saving');
    setError(null);
    try {
      await api.saveResume(content);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      setError('The resume was not saved. Try again.');
      setSaveState('idle');
    }
  }

  async function handlePdf() {
    if (!content) return;
    setPdfBusy(true);
    setError(null);
    try {
      const res = await api.generatePdf(content, 'Aryaman_Swami_Resume');
      if (res.ok) {
        const blob = await res.blob();
        onClose();
        onGeneratePdf(blob, 'Aryaman_Swami_Resume.pdf', content);
      } else {
        const data = await res.json();
        setError(data.error || 'The PDF did not compile.');
      }
    } catch {
      setError('The PDF request did not reach the server. Try again.');
    }
    setPdfBusy(false);
  }

  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box wide" role="dialog" aria-modal="true" aria-labelledby="resume-title" ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <div>
            <h2 id="resume-title">Base resume</h2>
            <p className="sub">The LaTeX every tailored version starts from. Edit \resumeEmail near the top to switch address.</p>
          </div>
          <button type="button" className="btn ghost icon-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <label htmlFor="resume-text" className="sr-only">Base resume LaTeX</label>
          <textarea id="resume-text" className="control code resume-text" rows={18} spellCheck={false}
            placeholder={loading ? 'Loading your resume…' : 'No resume saved yet. Paste your LaTeX source to start.'}
            value={content} onChange={e => setContent(e.target.value)} readOnly={loading} aria-busy={loading} data-autofocus />
          {error && <p className="error-line" role="alert" style={{ marginTop: 12 }}>{error}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn left" onClick={handlePdf} disabled={!content || pdfBusy} aria-busy={pdfBusy}>
            {pdfBusy && <span className="spinner" aria-hidden="true" />}
            {pdfBusy ? 'Building PDF…' : 'Generate PDF'}
          </button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn primary" onClick={handleSave} disabled={saveState === 'saving' || loading} aria-live="polite">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save resume'}
          </button>
        </div>
      </div>
    </div>
  );
}
