import { useRef } from 'react';

// The job list's own toolbar: search by company, sort, and how many rows are shown.
export default function Toolbar({ search, onSearchChange, sort, onSortChange, count, loading }) {
  const inputRef = useRef(null);
  const term = search.trim();
  return (
    <div className="list-tools">
      <div className="list-tools-row">
        <div className="search-wrap">
          <label htmlFor="job-search" className="sr-only">Search by company</label>
          <input id="job-search" ref={inputRef} className="control" type="search" placeholder="Search by company"
            autoComplete="off" value={search} onChange={e => onSearchChange(e.target.value)} />
          {search && (
            <button type="button" className="btn ghost icon-btn clear" aria-label="Clear search"
              onClick={() => { onSearchChange(''); inputRef.current?.focus(); }}>&times;</button>
          )}
        </div>
        <label htmlFor="job-sort" className="sr-only">Sort jobs</label>
        <select id="job-sort" className="control sort" value={sort} onChange={e => onSortChange(e.target.value)}>
          <option value="added_desc">Newest added</option>
          <option value="posted_desc">Recently posted</option>
          <option value="posted_asc">Oldest posted</option>
        </select>
      </div>
      <div className="count-line" aria-live="polite">
        {loading ? 'Loading jobs…' : term ? `${count} match "${term}"` : `${count} shown`}
      </div>
    </div>
  );
}
