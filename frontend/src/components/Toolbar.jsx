import { SOURCE } from '../utils.js';

const STATUS_FILTERS = [
  ['all', 'All'], ['to_ask', 'To Ask'], ['asked', 'Asked'], ['applied', 'Applied'],
  ['responded', 'Responded'], ['declined', 'Declined'],
];

export default function Toolbar({
  source, onSourceChange,
  search, onSearchChange,
  sort, onSortChange,
  status, onStatusChange,
  needsReferral, onToggleNeedsReferral,
}) {
  return (
    <>
      <nav className="source-tabs">
        <button className={`tab-btn${source === SOURCE.AUTO ? ' active' : ''}`} onClick={() => onSourceChange(SOURCE.AUTO)}>Auto-fetched</button>
        <button className={`tab-btn${source === SOURCE.MANUAL ? ' active' : ''}`} onClick={() => onSourceChange(SOURCE.MANUAL)}>Manually Added</button>
      </nav>

      <div className="search-bar">
        <input type="search" placeholder="Search by company…" autoComplete="off" value={search}
          onChange={e => onSearchChange(e.target.value)} />
        <select value={sort} onChange={e => onSortChange(e.target.value)}>
          <option value="added_desc">Sort: Newest Added</option>
          <option value="posted_desc">Sort: Recently Posted</option>
          <option value="posted_asc">Sort: Oldest Posted</option>
        </select>
      </div>

      <nav className="filters">
        {STATUS_FILTERS.map(([val, label]) => (
          <button key={val} className={`filter-btn${status === val ? ' active' : ''}`} onClick={() => onStatusChange(val)}>{label}</button>
        ))}
        <button className={`filter-btn filter-referral-toggle${needsReferral ? ' active' : ''}`} onClick={onToggleNeedsReferral}>
          &#128100; Needs Referral
        </button>
      </nav>
    </>
  );
}
