// The Job Tracker mark: a tick above two ledger rules (same drawing as /mark.svg).
export default function Mark({ large = false }) {
  return (
    <svg className={`mark${large ? ' large' : ''}`} viewBox="0 0 20 20" fill="none" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 6.2 L8 9 L14.5 2.8" />
      <path d="M3 13 H17" />
      <path d="M3 17 H12" />
    </svg>
  );
}
