export default function Header({ onResume, onSync, onAdd, onLogout, syncing, syncLabel }) {
  return (
    <header>
      <h1>Job Tracker</h1>
      <button className="btn-sync" title="Save your resume" onClick={onResume}>&#128196; Resume</button>
      <button className="btn-sync" title="Fetch latest jobs" onClick={onSync} disabled={syncing}>{syncLabel}</button>
      <button className="btn-primary" onClick={onAdd}>+ Add Job</button>
      <button className="btn-sync" title="Log out" onClick={onLogout}>Log out</button>
    </header>
  );
}
