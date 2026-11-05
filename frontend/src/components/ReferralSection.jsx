import { useState } from 'react';
import { buildReferralTemplate } from '../utils.js';
import Card from './Card.jsx';

function useCopy(text, idle) {
  const [label, setLabel] = useState(idle);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setLabel('Copied');
      setTimeout(() => setLabel(idle), 2000);
    }, () => setLabel('Copy failed'));
  }
  return [label, copy];
}

export function ReferralMessageSection({ job, onMarkAsked }) {
  const text = buildReferralTemplate(job);
  const [copyLabel, copy] = useCopy(text, 'Copy message');

  return (
    <Card
      title="Referral message"
      collapsible
      defaultOpen={!!job.needs_referral}
      badge={job.needs_referral ? <span className="pill warn">Needed</span> : null}
      actions={<button type="button" className="btn" onClick={copy} aria-live="polite">{copyLabel}</button>}
    >
      <pre className="well-text">{text}</pre>
      {job.status === 'to_ask' && (
        <div><button type="button" className="btn" onClick={onMarkAsked}>Mark as asked</button></div>
      )}
    </Card>
  );
}

export function LinkedinHelperSection({ job }) {
  const company = job.company || '';
  const role = job.role || '';
  const firstName = job.contact_name ? job.contact_name.split(' ')[0] : null;
  const query = job.contact_name ? `${job.contact_name} ${company}` : company;
  const url = job.linkedin_profile_url
    ? job.linkedin_profile_url
    : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;
  const greeting = firstName ? `Hi ${firstName}` : 'Hi';
  const note = `${greeting}, I'm applying for a ${role} role at ${company} and would love a referral if you think I'd be a good fit. Happy to share my resume!`;
  const [copyLabel, copy] = useCopy(note, 'Copy note');

  return (
    <Card
      title="LinkedIn note"
      collapsible
      defaultOpen={false}
      actions={
        <>
          <a className="btn ghost" target="_blank" rel="noopener noreferrer" href={url}>
            {job.linkedin_profile_url ? 'Open profile' : 'Find people'}
          </a>
          <button type="button" className="btn" onClick={copy} aria-live="polite">{copyLabel}</button>
        </>
      }
    >
      <pre className="well-text">{note}</pre>
    </Card>
  );
}
