// Ported from scraper/run_scraper.py's TITLE_EXCLUDE / MUST_CONTAIN /
// LOCATION_EXCLUDE / COMPANY_EXCLUDE. Naukri gives structured min/max
// experience directly (see parseExperience below) instead of needing the
// EXP_INCLUDE/EXP_EXCLUDE text regexes that file uses for Indeed/LinkedIn's
// free-text descriptions — that's actually more reliable here.
//
// KEEP THESE IN SYNC BY HAND with run_scraper.py's lists — there's no shared
// source between the Python and Node scrapers.

const TITLE_EXCLUDE = [
  /\bfront[\s-]?end\b/i,
  /\bfrontend\b/i,
  /\bui\s+(developer|engineer|dev)\b/i,
  /\bui\/ux\b/i,
  /\bux\s+(developer|designer|engineer)\b/i,
  /\breact\.?js?\s*(developer|engineer|dev)?\b/i,
  /\bangular\s+(developer|engineer|dev)\b/i,
  /\bvue\s+(developer|engineer|dev)\b/i,
  /\bjavascript\s+(developer|engineer|dev)\b/i,
  /\bweb\s+(developer|designer)\b/i,
  /\bnode\.?js\b/i,
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
  /\b[3-9]\+/,
  /\b1[0-9]\+/,
];

const MUST_CONTAIN = [/\bjava\b/i];

const LOCATION_EXCLUDE = [
  /\bchennai\b/i,
  /\btamil\s*nadu\b/i,
  /\bkochi\b/i,
  /\bkerala\b/i,
  /\bhyderabad\b/i,
  /\btelangana\b/i,
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

// Naukri's own "X-Y Yrs" range, e.g. "5-9 Yrs", "0-2 Yrs". Target band is
// 1-2 years, same as EXP_INCLUDE/EXP_EXCLUDE's intent in run_scraper.py:
// accept if the range's lower bound is 0-2 (covers fresher/junior through
// exactly 2 years), reject anything whose lower bound is 3+.
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

  const exp = parseExperience(job.experience);
  if (exp && exp.min > 2) return false;

  return true;
}

module.exports = { passesFilters, parseExperience };
