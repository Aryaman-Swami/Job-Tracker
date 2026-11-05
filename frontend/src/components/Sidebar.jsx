import { useRef } from 'react';
import Mark from './Mark.jsx';
import { useIndicator } from '../hooks.js';

const VIEWS = [
  { id: 'scraped', label: 'Scraped jobs', href: '#/jobs/scraped' },
  { id: 'manual', label: 'Added by me', href: '#/jobs/manual' },
];

function syncText(state) {
  if (state === 'busy') return 'Syncing…';
  if (state === 'done') return 'Synced just now';
  if (state === 'failed') return 'Sync failed. Try again';
  return 'Sync jobs';
}

// The labelled sidebar on desktop; the same content fills the phone's menu sheet.
export default function Sidebar({ view, toAsk, onNavigate, onResume, needsReferral, onToggleNeedsReferral, syncState, lastSynced, onSync, onLogout, sheet = false }) {
  const navRef = useRef(null);
  const pill = useIndicator(navRef, '[aria-current="page"]', view);

  return (
    <>
      {!sheet && (
        <div className="brand">
          <Mark />
          <div>
            <div className="brand-name">Job Tracker</div>
            <div className="brand-scope">Personal workspace</div>
          </div>
        </div>
      )}

      <nav className="nav" aria-label="Views" ref={navRef}>
        {pill && <span className="nav-pill" aria-hidden="true" style={{ transform: `translateY(${pill.y + 6}px)` }} />}
        {VIEWS.map(v => (
          <a key={v.id} href={v.href} className="nav-item" aria-current={view === v.id ? 'page' : undefined}
            onClick={() => onNavigate?.(v.id)}>
            <span>{v.label}</span>
            {v.id === 'scraped' && toAsk > 0 && <span className="nav-count">To ask {toAsk}</span>}
          </a>
        ))}
        <a href="#/resume" className="nav-item" onClick={() => onResume?.()}>
          <span>Base resume</span>
        </a>
      </nav>

      <div className="group-label">Filters</div>
      <label className="switch-row">
        <span>Needs a referral</span>
        <input type="checkbox" role="switch" className="switch" checked={needsReferral}
          aria-checked={needsReferral} onChange={onToggleNeedsReferral} />
      </label>

      <div className="sidebar-foot">
        <button type="button" className="nav-item" onClick={onSync} disabled={syncState === 'busy'} aria-busy={syncState === 'busy'}>
          <span>{syncText(syncState)}</span>
          {syncState === 'busy' && <span className="spinner" aria-hidden="true" />}
        </button>
        {lastSynced && syncState !== 'busy' && (
          <div className={`sync-stamp${syncState === 'failed' ? ' failed' : ''}`}>
            Last synced {lastSynced.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
        <button type="button" className="nav-item" onClick={onLogout}><span>Log out</span></button>
      </div>
    </>
  );
}
