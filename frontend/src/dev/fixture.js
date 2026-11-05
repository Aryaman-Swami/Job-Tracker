// Dev-only sample data for checking the interface without the backend (open the dev server
// with ?fixture). Never imported by the production build. Every company and person here is
// fictional; emails use the reserved .example domain.

const HOUR = 36e5;
const DAY = 24 * HOUR;

// Today's rows sit minutes to hours before now but never before midnight, so they always
// group under "Today"; older rows sit at a fixed hour on their day.
function at(daysAgo, hour, minute = 0) {
  const now = new Date();
  if (daysAgo === 0) {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return new Date(Math.max(midnight + 60e3, now.getTime() - (10 - hour) * 50 * 60e3 - 9 * 60e3));
  }
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute);
  return d;
}

const BREAKDOWN = (keywords, skills, experience, title) => ({ keywords, skills, experience, title_alignment: title });

// [company, role, source, status, needsReferral, atsScore|null, daysAgo, hour, contact]
const SCRAPED = [
  // Today: 7
  ['Northwind Payments', 'Backend Engineer', 'linkedin', 'to_ask', true, 72, 0, 9, 'Priya Raman'],
  ['Halden Analytics', 'Software Engineer II', 'workday', 'to_ask', true, null, 0, 9],
  ['Tessera Labs', 'Java Spring Boot Developer', 'naukri', 'to_ask', false, 64, 0, 8],
  ['Juniper Lending', 'Senior Backend Engineer', 'linkedin', 'asked', true, 81, 0, 8, 'Rohan Mehta'],
  ['Orchard Systems', 'Platform Engineer', 'instahyre', 'applied', false, null, 0, 7],
  ['Saltmarsh Media', 'Software Developer, APIs', 'workday', 'to_ask', false, null, 0, 7],
  ['Pinecrest Software', 'Backend Developer (Java)', 'naukri', 'applied', false, 77, 0, 6],
  // Yesterday: 6
  ['Kestrel Health', 'Senior Java Developer', 'workday', 'applied', false, 81, 1, 18],
  ['Larkspur Logistics', 'Software Engineer, Payments', 'linkedin', 'asked', true, 69, 1, 16, 'Ananya Iyer'],
  ['Ridgeline Telecom', 'Java Microservices Engineer', 'naukri', 'to_ask', true, null, 1, 15],
  ['Quarry Data', 'Data Platform Engineer', 'instahyre', 'responded', false, 86, 1, 12],
  ['Bluefen Energy', 'Backend Engineer II', 'linkedin', 'applied', false, null, 1, 11],
  ['Arbor Mobility', 'Software Engineer, Backend', 'workday', 'declined', false, 48, 1, 10],
  // Two days ago: 5
  ['Cobalt Ledger', 'Senior Software Engineer', 'linkedin', 'asked', true, 74, 2, 17, 'Kabir Shah'],
  ['Fernhill Travel', 'Java Developer', 'naukri', 'to_ask', true, null, 2, 15],
  ['Brightwater Insurance', 'Backend Engineer, Claims', 'workday', 'applied', false, 70, 2, 13],
  ['Copperleaf Retail', 'Software Engineer II, Checkout', 'instahyre', 'responded', false, 79, 2, 11],
  ['Meridian Freight', 'Spring Boot Engineer', 'linkedin', 'asked', false, null, 2, 9],
];

// The page after "Load 3 more days".
const OLDER = [
  ['Granite Bay Bank', 'Backend Engineer', 'workday', 'to_ask', true, null, 4, 14],
  ['Wrenfield Studios', 'Software Engineer', 'linkedin', 'applied', false, 66, 4, 10],
  ['Sable Point Security', 'Java Engineer', 'naukri', 'declined', false, 52, 5, 12],
];

const MANUAL = [
  ['Westbrook Capital', 'Backend Engineer', 'manual', 'asked', true, 75, 0, 10, 'Meera Pillai'],
  ['Lumen Grid', 'Senior Java Developer', 'manual', 'applied', false, 68, 1, 14],
  ['Harbor & Vale', 'Software Engineer II', 'manual', 'to_ask', true, null, 1, 9, 'Dev Arora'],
  ['Stonemill Games', 'Backend Developer', 'manual', 'responded', false, 83, 3, 16],
];

const KEYWORDS = {
  matched: ['Java', 'Spring Boot', 'PostgreSQL', 'REST APIs', 'Docker'],
  missing: ['Kafka', 'Kubernetes'],
};

let nextId = 1;
function toJob([company, role, source, status, needsReferral, ats, daysAgo, hour, contact]) {
  const id = nextId++;
  const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
  const created = at(daysAgo, hour, 15);
  const postedGap = daysAgo === 0 ? 0 : 2 * HOUR;
  const posted = new Date(created.getTime() - postedGap);
  return {
    id,
    company,
    role,
    source,
    status,
    needs_referral: needsReferral,
    job_ref_id: `${slug.slice(0, 3).toUpperCase()}-${4400 + id}`,
    contact_name: contact || null,
    contact_email: contact ? `${contact.split(' ')[0].toLowerCase()}@${slug}.example` : null,
    job_url: `https://careers.${slug}.example/jobs/${4400 + id}`,
    linkedin_profile_url: null,
    notes: status === 'responded' ? 'Recruiter screen booked, waiting on a time.' : null,
    description: `${company} is hiring a ${role}.\n\nYou will build and run Java 17 and Spring Boot services backed by PostgreSQL, ship REST APIs used by internal teams, and own their deploys on Docker. Experience with Kafka and Kubernetes is a plus.`,
    created_at: created.toISOString(),
    date_posted: posted.toISOString(),
    ats_score: ats,
    ats_breakdown: ats == null ? null : BREAKDOWN(Math.max(ats - 7, 0), Math.min(ats + 8, 100), ats - 2, Math.min(ats + 4, 100)),
    ats_matched_keywords: ats == null ? null : KEYWORDS.matched,
    ats_missing_keywords: ats == null ? null : KEYWORDS.missing,
    ats_suggestions: ats == null ? null : ['Add a bullet on event-driven work if the job scraper used a queue.', 'Name Kubernetes only if you have run workloads on it.'],
    tailored_resume_latex: null,
    tailored_skills_match: null,
  };
}

export const fixture = {
  scraped: SCRAPED.map(toJob),
  older: OLDER.map(toJob),
  manual: MANUAL.map(toJob),
};

export const BASE_RESUME = String.raw`\documentclass[10pt]{article}
% Sample data: replace with your own base resume.
\begin{document}
\section*{Experience}
Backend engineer working on Java and Spring Boot services.
\end{document}`;

// ---- figures that must agree ----
const count = (rows, pred) => rows.filter(pred).length;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgoOf = j => Math.round((startOfDay(new Date()) - startOfDay(new Date(j.created_at))) / DAY);
const s = fixture.scraped;
const stageCounts = ['to_ask', 'asked', 'applied', 'responded', 'declined'].map(st => count(s, j => j.status === st));
console.assert(s.length === 18, 'fixture: 18 scraped jobs on the first page');
console.assert([0, 1, 2].map(d => count(s, j => daysAgoOf(j) === d)).join() === '7,6,5', 'fixture: day groups are 7, 6, 5');
console.assert(stageCounts.join() === '6,4,5,2,1', 'fixture: stages are 6, 4, 5, 2, 1');
console.assert(stageCounts.reduce((a, b) => a + b, 0) === s.length, 'fixture: stage counts sum to All');
console.assert(count(s, j => j.needs_referral) === 7, 'fixture: 7 jobs need a referral');
console.assert(count(s, j => j.ats_score != null) === 11, 'fixture: 11 jobs carry a match score');
console.assert(fixture.manual.length === 4, 'fixture: 4 manual jobs');
