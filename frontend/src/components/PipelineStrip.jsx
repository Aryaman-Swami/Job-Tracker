import { useRef } from 'react';
import { PIPELINE_STAGES, STATUS_LABELS } from '../utils.js';
import { useIndicator } from '../hooks.js';

// The application pipeline: one divided strip counting the loaded jobs at each stage.
// It is also the status filter. The API filters by stage, so while one stage is selected
// the other stages cannot be counted and show a dash instead of a wrong zero.
export default function PipelineStrip({ jobs, status, onStatusChange, loading, error }) {
  const ref = useRef(null);
  const bar = useIndicator(ref, '[aria-selected="true"]', `${status}|${loading}`);
  const tabs = [['all', 'All stages'], ...PIPELINE_STAGES.map(s => [s, STATUS_LABELS[s]])];

  function countFor(id) {
    if (error) return null;
    if (status === 'all') return id === 'all' ? jobs.length : jobs.filter(j => j.status === id).length;
    return id === status ? jobs.length : null;
  }

  function onKeyDown(e) {
    const i = tabs.findIndex(([id]) => id === status);
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next == null) return;
    e.preventDefault();
    onStatusChange(tabs[next][0]);
    const el = ref.current?.querySelectorAll('[role="tab"]')[next];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <div className="pipeline" role="tablist" aria-label="Application stage" ref={ref} onKeyDown={onKeyDown}>
      {tabs.map(([id, label]) => {
        const n = countFor(id);
        const selected = status === id;
        return (
          <button key={id} type="button" role="tab" className="stage" aria-selected={selected} tabIndex={selected ? 0 : -1}
            title={n == null && !loading ? 'Select All stages to count this stage' : undefined}
            onClick={() => onStatusChange(id)}>
            <span className="stage-label">{label}</span>
            {loading
              ? <span className="stage-count"><span className="skeleton" /></span>
              : n == null
                ? <span className="stage-count unknown">-</span>
                : <span className={`stage-count${n === 0 ? ' zero' : ''}`}>{n}</span>}
          </button>
        );
      })}
      {bar && <span className="pipeline-bar" aria-hidden="true" style={{ width: bar.w, transform: `translateX(${bar.x}px)` }} />}
    </div>
  );
}
