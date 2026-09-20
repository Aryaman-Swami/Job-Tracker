import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { buildResumeFilename } from '../utils.js';

export default function PdfPreviewModal({ open, pdfBlob, initialLatex, filename, jobId, company, onClose, onSaved }) {
  const [latex, setLatex] = useState('');
  const [objectUrl, setObjectUrl] = useState(null);
  const [saveLabel, setSaveLabel] = useState('Save & Recompile');
  const [saving, setSaving] = useState(false);
  const urlRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLatex(initialLatex || '');
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
    setSaving(true);
    setSaveLabel('Saving…');
    const baseName = buildResumeFilename(company).replace(/\.pdf$/, '');

    try {
      const [pdfRes, saveRes] = await Promise.all([
        api.generatePdf(latex, baseName),
        api.saveTailoredLatex(jobId, latex),
      ]);

      if (pdfRes.ok) {
        const blob = await pdfRes.blob();
        replaceObjectUrl(blob);
      } else {
        const data = await pdfRes.json();
        alert(data.error || 'PDF recompilation failed.');
      }

      if (saveRes.ok) {
        setSaveLabel('Saved!');
        onSaved(latex);
      } else {
        setSaveLabel('Save & Recompile');
        alert('Saving the LaTeX failed.');
      }
    } catch {
      alert('Request failed.');
      setSaveLabel('Save & Recompile');
    }
    setTimeout(() => { setSaveLabel('Save & Recompile'); setSaving(false); }, 1500);
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

  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box pdf-modal-box">
        <div className="modal-header">
          <h2>Resume Preview</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="copy-btn" onClick={handleOpenTab}>Open in New Tab</button>
            <button type="button" className="copy-btn" onClick={handleDownload}>Download</button>
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>
        </div>
        <div className="pdf-editor-layout">
          <div className="pdf-editor-pane">
            <div className="pdf-editor-header">
              <span>LaTeX Source</span>
              <button type="button" className="copy-btn" onClick={handleSaveRecompile} disabled={saving}>{saveLabel}</button>
            </div>
            <textarea className="pdf-latex-editor" spellCheck={false} value={latex} onChange={e => setLatex(e.target.value)} />
          </div>
          <iframe className="pdf-frame" title="Resume PDF preview" src={objectUrl || ''} />
        </div>
      </div>
    </div>
  );
}
