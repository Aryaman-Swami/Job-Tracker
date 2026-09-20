import { useState } from 'react';
import { buildReferralTemplate } from '../utils.js';

export function ReferralMessageSection({ job }) {
  const [open, setOpen] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy');
  const text = buildReferralTemplate(job);

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 2000);
    });
  }

  return (
    <>
      <button className="btn-referral" onClick={() => setOpen(o => !o)}>&#9993; Generate Referral Message</button>
      {open && (
        <div className="referral-box">
          <div className="referral-header">
            <span>Referral Message</span>
            <button className={`copy-btn${copyLabel === 'Copied!' ? ' copied' : ''}`} onClick={copy}>{copyLabel}</button>
          </div>
          <pre className="template-text">{text}</pre>
        </div>
      )}
    </>
  );
}

export function LinkedinHelperSection({ job }) {
  const [open, setOpen] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy Note');

  const company = job.company || '';
  const role = job.role || '';
  const firstName = job.contact_name ? job.contact_name.split(' ')[0] : null;
  const query = job.contact_name ? `${job.contact_name} ${company}` : company;
  const url = job.linkedin_profile_url
    ? job.linkedin_profile_url
    : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;
  const greeting = firstName ? `Hi ${firstName}` : 'Hi';
  const note = `${greeting}, I'm applying for a ${role} role at ${company} and would love a referral if you think I'd be a good fit. Happy to share my resume!`;

  function copy() {
    navigator.clipboard.writeText(note).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy Note'), 2000);
    });
  }

  return (
    <>
      <button className="btn-referral" onClick={() => setOpen(o => !o)}>&#128100; LinkedIn Helper</button>
      {open && (
        <div className="referral-box">
          <div className="referral-header">
            <span>LinkedIn Helper</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <a className="copy-btn" target="_blank" rel="noopener noreferrer" href={url}>
                {job.linkedin_profile_url ? 'Open Profile' : 'Search LinkedIn'}
              </a>
              <button className={`copy-btn${copyLabel === 'Copied!' ? ' copied' : ''}`} onClick={copy}>{copyLabel}</button>
            </div>
          </div>
          <pre className="template-text">{note}</pre>
        </div>
      )}
    </>
  );
}
