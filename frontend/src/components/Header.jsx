import { useState } from 'react';
import Mark from './Mark.jsx';
import Sidebar from './Sidebar.jsx';
import { useDialog } from '../hooks.js';

// Under 1100px the sidebar folds into this 48px bar: the mark and product name, the one
// action (Add job) and a menu button that opens the navigation as a full-screen sheet.
export default function Header({ onAdd, addPrimary, sidebarProps }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sheetRef = useDialog(menuOpen, () => setMenuOpen(false));
  const close = () => setMenuOpen(false);

  return (
    <header className="topbar">
      <Mark />
      <span className="brand-name">Job Tracker</span>
      <button type="button" className={`btn${addPrimary ? ' primary' : ''}`} onClick={onAdd}>Add job</button>
      <button type="button" className="btn ghost" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>Menu</button>

      {menuOpen && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Menu" ref={sheetRef} tabIndex={-1}>
          <div className="sheet-head">
            <div className="brand">
              <Mark />
              <div>
                <div className="brand-name">Job Tracker</div>
                <div className="brand-scope">Personal workspace</div>
              </div>
            </div>
            <button type="button" className="btn ghost" onClick={close}>Close</button>
          </div>
          <Sidebar
            {...sidebarProps}
            sheet
            onNavigate={v => { sidebarProps.onNavigate?.(v); close(); }}
            onResume={() => { close(); sidebarProps.onResume?.(); }}
            onLogout={() => { close(); sidebarProps.onLogout(); }}
          />
        </div>
      )}
    </header>
  );
}
