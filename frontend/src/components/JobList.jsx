import JobCard from './JobCard.jsx';
import { monthKey, postedTime } from '../utils.js';

export default function JobList({ jobs, search, sort, selectedJobId, onSelect, onEdit, onDelete, onStatusChange }) {
  let filtered = search
    ? jobs.filter(j => j.company.toLowerCase().includes(search))
    : jobs;

  if (!filtered.length) {
    return <div className="job-list"><div className="empty">No jobs here yet.</div></div>;
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
      </div>
    );
  }

  const groups = [];
  const seen = {};
  for (const job of filtered) {
    const key = monthKey(job.created_at);
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
    </div>
  );
}
