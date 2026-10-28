import JobCard from './JobCard.jsx';
import { dayKey, postedTime } from '../utils.js';

export default function JobList({ jobs, sort, loading, hasMore, loadingMore, onLoadMore, selectedJobId, onSelect, onEdit, onDelete, onStatusChange }) {
  let filtered = jobs;

  const loadMoreButton = hasMore && (
    <button className="filter-btn" style={{ margin: '16px auto', display: 'block' }} disabled={loadingMore} onClick={onLoadMore}>
      {loadingMore ? 'Loading…' : 'Load older days'}
    </button>
  );

  if (!filtered.length) {
    return (
      <div className="job-list">
        <div className="empty">{loading ? 'Loading…' : 'No jobs here yet.'}</div>
        {loadMoreButton}
      </div>
    );
  }

  if (sort === 'posted_desc') {
    filtered = [...filtered].sort((a, b) => postedTime(b) - postedTime(a));
  } else if (sort === 'posted_asc') {
    filtered = [...filtered].sort((a, b) => postedTime(a) - postedTime(b));
  }

  const cardProps = job => ({
    key: job.id,
    job,
    selected: job.id === selectedJobId,
    onSelect,
    onEdit,
    onDelete,
    onStatusChange,
  });

  if (sort !== 'added_desc') {
    return (
      <div className="job-list">
        <div className="month-group">
          {filtered.map(job => <JobCard {...cardProps(job)} />)}
        </div>
        {loadMoreButton}
      </div>
    );
  }

  const groups = [];
  const seen = {};
  for (const job of filtered) {
    const key = dayKey(job.created_at);
    if (!seen[key]) { seen[key] = []; groups.push({ key, items: seen[key] }); }
    seen[key].push(job);
  }

  return (
    <div className="job-list">
      {groups.map(({ key, items }) => (
        <div key={key}>
          <div className="month-heading"><span>{key}</span><span className="month-count">{items.length}</span></div>
          <div className="month-group">
            {items.map(job => <JobCard {...cardProps(job)} />)}
          </div>
        </div>
      ))}
      {loadMoreButton}
    </div>
  );
}
