import { useState } from 'react';
import { useDialog } from '../hooks.js';

// A confirmation that names the object, in place of the browser's confirm().
export default function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onClose }) {
  const ref = useDialog(open, onClose);
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  async function confirm() {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  }

  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id="confirm-title">{title}</h2>
          <button type="button" className="btn ghost icon-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body"><p>{body}</p></div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose} data-autofocus>Cancel</button>
          <button type="button" className="btn primary" onClick={confirm} disabled={busy} aria-busy={busy}>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
