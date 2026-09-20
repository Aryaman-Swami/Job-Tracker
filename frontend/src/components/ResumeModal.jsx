import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ResumeModal({ open, onClose, onGeneratePdf }) {
  const [content, setContent] = useState('');
  const [saveLabel, setSaveLabel] = useState('Save Resume');
  const [pdfLabel, setPdfLabel] = useState('Generate PDF');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.getResume().then(d => setContent(d.content || ''));
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setSaveLabel('Saving…');
    await api.saveResume(content);
    setSaveLabel('Saved!');
    setTimeout(() => { setSaveLabel('Save Resume'); setSaving(false); }, 1200);
  }

  async function handlePdf() {
    if (!content) return;
    setPdfLabel('Generating…');
    try {
      const res = await api.generatePdf(content, 'Aryaman_Swami_Resume');
      if (res.ok) {
        const blob = await res.blob();
        onClose();
        onGeneratePdf(blob, 'Aryaman_Swami_Resume.pdf', content);
      } else {
        const data = await res.json();
        alert(data.error || 'PDF generation failed.');
      }
    } catch {
      alert('Request failed.');
    }
    setPdfLabel('Generate PDF');
  }

  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 820 }}>
        <div className="modal-header">
          <h2>Your Resume (LaTeX)</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="resume-section">
          <div className="resume-section-label">Base Resume &mdash; edit \resumeEmail near the top to switch address</div>
          <textarea rows={12} className="resume-textarea" placeholder="Paste your full LaTeX resume here..."
            value={content} onChange={e => setContent(e.target.value)} />
          <div className="form-actions" style={{ marginTop: 8 }}>
            <button type="button" className="copy-btn" onClick={handlePdf}>{pdfLabel}</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>{saveLabel}</button>
          </div>
        </div>
        <div className="form-actions" style={{ marginTop: 4 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
