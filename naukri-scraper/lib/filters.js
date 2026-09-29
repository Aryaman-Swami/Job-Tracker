// This pipeline's own filter spec — diverged from scraper/run_scraper.py's
// on purpose (Node.js roles are wanted here, unlike the Java-only Indeed/
// LinkedIn pipeline; locations are an include-list, not run_scraper.py's
// exclude-list, and Hyderabad is wanted here despite being excluded there).
// Not a port anymore — don't try to keep this in sync with run_scraper.py.

const TITLE_EXCLUDE = [
  /\bfront[\s-]?end\b/i,
  /\bfrontend\b/i,
  /\bui\s+(developer|engineer|dev)\b/i,
  /\bui\/ux\b/i,
  /\bux\s+(developer|designer|engineer)\b/i,
  /\breact\.?js?\s*(developer|engineer|dev)?\b/i,
  /\bangular\s+(developer|engineer|dev)\b/i,
  /\bvue\s+(developer|engineer|dev)\b/i,
  /\bjavascript\s+(developer|engineer|dev)\b/i, // plain-JS/frontend roles, not Node backend
  /\bweb\s+(developer|designer)\b/i,
  /\bSDE[-\s]?[3-9]\b/i,
  /\bSD[-\s]?[3-9]\b/i,
  /\bL[4-9]\b/,
  /\bE[4-9]\b/,
  /\bIC[3-9]\b/i,
  /\bP[4-9]\b/,
  /\b(SDE|SD|engineer|developer|dev|analyst)[-\s]*(III|IV|V|VI|VII|VIII|IX|X)\b/i,
  /\bsenior\b/i,
  /\bsr\.?\b/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\blead\b/i,
  /\b[5-9]\+/, // "5+ years" etc in the title — 2+ is our floor, not ceiling, so only block clearly-senior N+
  /\b1[0-9]\+/,
];

// Java OR Node.js — not AND, either stack qualifies.
const MUST_CONTAIN = [/\bjava\b/i, /\bnode(\.?js)?\b/i];

// Include-list, not an exclude-list: only these cities pass. Deliberately
// covers both spellings of Bangalore and plain "Noida" or "Greater Noida".
const LOCATION_INCLUDE = [
  /\bpune\b/i,
  /\b(bangalore|bengaluru)\b/i,
  /\bnoida\b/i,
  /\bhyderabad\b/i,
];

// Explicit per your instruction, even though they'd already fail the
// include-list above — keeps the exclusion visible/intentional in the code.
const LOCATION_EXCLUDE = [/\bchennai\b/i, /\bkochi\b/i];

// Defense-in-depth against non-India postings slipping through: Naukri's
// location field is sometimes multi-site ("Bangalore, Dubai") or the client
// site is abroad while the listing tags an Indian city as the recruiter's
// base — so also reject on any clear abroad marker, checked against BOTH
// the location field and the full description (title alone rarely says it).
const ABROAD_EXCLUDE = [
  /\bdubai\b/i,
  /\b(u\.?a\.?e\.?|united\s+arab\s+emirates)\b/i,
  /\bsingapore\b/i,
  /\bsaudi(\s+arabia)?\b/i,
  /\bqatar\b/i,
  /\bkuwait\b/i,
  /\bbahrain\b/i,
  /\boman\b/i,
  /\bgulf\b/i,
  /\b(usa|u\.?s\.?a\.?|united\s+states)\b/i,
  /\b(uk|u\.?k\.?|united\s+kingdom)\b/i,
  /\blondon\b/i,
  /\bcanada\b/i,
  /\baustralia\b/i,
  /\bgermany\b/i,
  /\bnetherlands\b/i,
  /\bireland\b/i,
  /\bmalaysia\b/i,
  /\bphilippines\b/i,
  /\bvietnam\b/i,
  /\bindonesia\b/i,
  /\bjapan\b/i,
  /\bhong\s+kong\b/i,
  /\beurope\b/i,
  /\boverseas\b/i,
  /\binternational\s+location\b/i,
];

const COMPANY_EXCLUDE = [
  /\bcapgemini\b/i,
  /\btata\s+consultancy\b/i,
  /\btcs\b/i,
  /\binfosys\b/i,
  /\bpersistent\s+systems?\b/i,
  /\bdeloitte\b/i,
  /\bwipro\b/i,
  /\bhcl\b/i,
  /\btechmahindra\b/i,
  /\btech\s+mahindra\b/i,
  /\bcognizant\b/i,
  /\baccenture\b/i,
  /\bmphasis\b/i,
  /\blti\b/i,
  /\bltimindtree\b/i,
  /\bcoforge\b/i,
  /\bhexaware\b/i,
  /\bniit\b/i,
];

function matchesAny(patterns, text) {
  return patterns.some((p) => p.test(text || ''));
}

// Naukri's own "X-Y Yrs" range, e.g. "5-9 Yrs", "0-2 Yrs". "2+ years" is
// read as open-ended upward: accept any range that reaches at least 2 (so
// "2-5", "1-3", "3-6" all pass), reject only ranges that top out below 2
// (pure-fresher "0-1" postings).
function parseExperience(text) {
  const m = /(\d+)\s*-\s*(\d+)\s*yrs?/i.exec(text || '');
  if (!m) return null;
  return { min: Number(m[1]), max: Number(m[2]) };
}

function passesFilters(job) {
  const title = job.title || '';
  const combined = `${title} ${job.description || ''}`;

  if (matchesAny(COMPANY_EXCLUDE, job.company)) return false;
  if (matchesAny(TITLE_EXCLUDE, title)) return false;
  if (!matchesAny(MUST_CONTAIN, combined)) return false;
  if (matchesAny(LOCATION_EXCLUDE, job.location)) return false;
  if (!matchesAny(LOCATION_INCLUDE, job.location)) return false;
  if (matchesAny(ABROAD_EXCLUDE, job.location) || matchesAny(ABROAD_EXCLUDE, job.description)) return false;

  const exp = parseExperience(job.experience);
  if (exp && exp.max < 2) return false;

  return true;
}

module.exports = { passesFilters, parseExperience };
