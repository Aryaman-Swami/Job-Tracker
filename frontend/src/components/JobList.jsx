import { useRef } from 'react';
import JobCard from './JobCard.jsx';
import { addedDayLabel, postedTime } from '../utils.js';
import { useFlip } from '../hooks.js';

function sortJobs(jobs, sort) {
  if (sort === 'posted_desc') return [...jobs].sort((a, b) => postedTime(b) - postedTime(a));
  if (sort === 'posted_asc') return [...jobs].sort((a, b) => postedTime(a) - postedTime(b));
  return jobs;
}

const clock = d => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export default function JobList({ jobs, sort, loading, error, lastLoaded, onRetry, emptyText, hasMore, loadingMore, onLoadMore, selectedJobId, onSelect, tailoringIds }) {
  const listRef = useRef(null);
  const sorted = sortJobs(jobs, sort);
  useFlip(listRef, loading || error ? [] : sorted.map(j => String(j.id)));

  if (loading) {
    return (
      <div className="job-scroll" aria-busy="true">
        <div className="day-head"><span>Loading jobs…</span></div>
        <ul className="job-items">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <div className="job-row is-skeleton" aria-hidden="true">
                <span className="job-line"><span className="skeleton" style={{ width: 140 }} /><span className="skeleton" style={{ width: 48, marginLeft: 'auto' }} /></span>
                <span className="job-line"><span className="skeleton" style={{ width: 180 }} /></span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (error) {
    return (
      <div className="job-scroll">
        <div className="list-state">
          <p className="error-line" role="alert">
            Couldn&apos;t load jobs.{lastLoaded ? ` Last loaded ${clock(lastLoaded)}.` : ''}
            <button type="button" className="link-btn" onClick={onRetry}>Retry</button>
          </p>
        </div>
      </div>
    );
  }

  // Newest-added keeps the day groups; the posting-date sorts read as one run.
  const groups = [];
  if (sort === 'added_desc') {
    const seen = {};
    for (const job of sorted) {
      const key = addedDayLabel(job.created_at);
      if (!seen[key]) { seen[key] = []; groups.push({ key, items: seen[key] }); }
      seen[key].push(job);
    }
  } else if (sorted.length) {
    groups.push({ key: sort === 'posted_desc' ? 'Most recently posted first' : 'Oldest posting first', items: sorted });
  }

  return (
    <div className="job-scroll" ref={listRef}>
      {!sorted.length && (
        <div className="list-state"><div className="empty">{emptyText}</div></div>
      )}
      {groups.map(({ key, items }) => (
        <section key={key} aria-label={key}>
          <div className="day-head"><span>{key}</span><span className="num">{items.length}</span></div>
          <ul className="job-items">
            {items.map(job => (
              <li key={job.id} data-flip={job.id}>
                <JobCard job={job} selected={job.id === selectedJobId} tailoring={tailoringIds.has(job.id)} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <div className="list-foot">
          <button type="button" className="btn block" disabled={loadingMore} aria-busy={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Loading…' : 'Load 3 more days'}
          </button>
        </div>
      )}
      {!hasMore && sorted.length > 0 && <div className="list-end">All loaded jobs shown</div>}
    </div>
  );
}
