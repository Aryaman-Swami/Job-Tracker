import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { buildResumeFilename } from '../utils.js';
import { useDialog, useMediaQuery } from '../hooks.js';

export default function PdfPreviewModal({ open, pdfBlob, initialLatex, filename, jobId, company, onClose, onSaved }) {
  const [latex, setLatex] = useState('');
  const [objectUrl, setObjectUrl] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('preview');
  const compact = useMediaQuery('(max-width: 640px)');
  const urlRef = useRef(null);
  const ref = useDialog(open, onClose);

  useEffect(() => {
    if (!open) return undefined;
    setLatex(initialLatex || '');
    setError(null); setSaveState('idle'); setTab('preview');
    if (pdfBlob) {
      const url = URL.createObjectURL(pdfBlob);
      urlRef.current = url;
      setObjectUrl(url);
    }
    return () => {
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pdfBlob]);

  if (!open) return null;

  function replaceObjectUrl(blob) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setObjectUrl(url);
  }

  async function handleSaveRecompile() {
    if (!latex || !jobId) return;
    setSaveState('saving');
    setError(null);
    const baseName = buildResumeFilename(company).replace(/\.pdf$/, '');
    try {
      const [pdfRes, saveRes] = await Promise.all([
        api.generatePdf(latex, baseName),
        api.saveTailoredLatex(jobId, latex),
      ]);
      if (pdfRes.ok) {
        replaceObjectUrl(await pdfRes.blob());
      } else {
        const data = await pdfRes.json();
        setError(data.error || 'The PDF did not recompile. Check the LaTeX source.');
      }
      if (saveRes.ok) {
        setSaveState('saved');
        onSaved(latex);
        setTimeout(() => setSaveState('idle'), 1500);
      } else {
        setError('Saving the LaTeX failed.');
        setSaveState('idle');
      }
    } catch {
      setError('The request did not reach the server. Try again.');
      setSaveState('idle');
    }
  }

  function handleDownload() {
    if (!objectUrl) return;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.click();
  }

  function handleOpenTab() {
    if (objectUrl) window.open(objectUrl, '_blank');
  }

  const showPreview = !compact || tab === 'preview';
  const showLatex = !compact || tab === 'latex';

  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box pdf" role="dialog" aria-modal="true" aria-labelledby="pdf-title" ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <div className="truncate">
            <h2 id="pdf-title" className="truncate">{company ? `Tailored resume for ${company}` : 'Resume preview'}</h2>
            {filename && <p className="sub mono truncate">{filename}</p>}
          </div>
          <div className="actions">
            {!compact && <button type="button" className="btn ghost" onClick={handleOpenTab} disabled={!objectUrl}>Open in new tab</button>}
            {!compact && <button type="button" className="btn primary" onClick={handleDownload} disabled={!objectUrl} data-autofocus>Download PDF</button>}
            <button type="button" className="btn ghost icon-btn" aria-label="Close" onClick={onClose}>&times;</button>
          </div>
        </div>

        {compact && (
          <div className="pdf-tabs" role="tablist" aria-label="Resume view">
            <button type="button" role="tab" className="pdf-tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
            <button type="button" role="tab" className="pdf-tab" aria-selected={tab === 'latex'} onClick={() => setTab('latex')}>LaTeX</button>
          </div>
        )}
        {error && <div className="modal-error"><p className="error-line" role="alert">{error}</p></div>}

        <div className="pdf-body">
          <div className="pdf-pane" hidden={!showPreview}>
            <div className="pdf-frame-wrap">
              {objectUrl
                ? <iframe className="pdf-frame" title="Resume PDF preview" src={objectUrl} />
                : <div className="pdf-state">Rendering PDF…</div>}
            </div>
          </div>
          <div className="pdf-pane" hidden={!showLatex}>
            <div className="pdf-pane-head">
              <span>LaTeX source</span>
              {jobId && (
                <button type="button" className="btn ghost" onClick={handleSaveRecompile} disabled={saveState === 'saving'} aria-live="polite">
                  {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save and recompile'}
                </button>
              )}
            </div>
            <label htmlFor="pdf-latex" className="sr-only">LaTeX source</label>
            <textarea id="pdf-latex" className="control code pdf-latex" spellCheck={false} value={latex} onChange={e => setLatex(e.target.value)} />
          </div>
        </div>

        {compact && (
          <div className="modal-foot">
            <button type="button" className="btn" onClick={handleOpenTab} disabled={!objectUrl}>Open in new tab</button>
            <button type="button" className="btn primary" onClick={handleDownload} disabled={!objectUrl}>Download PDF</button>
          </div>
        )}
      </div>
    </div>
  );
}
