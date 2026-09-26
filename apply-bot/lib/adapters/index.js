const workday = require('./workday');
const naukri = require('./naukri');
const linkedin = require('./linkedin');
const indeed = require('./indeed');
const greenhouse = require('./greenhouse');
const lever = require('./lever');
const wellfound = require('./wellfound');
const generic = require('./generic');

// generic MUST stay last — its matches() always returns true, so it's the
// fallback only when nothing more specific claims the URL first.
const ADAPTERS = [workday, naukri, linkedin, indeed, greenhouse, lever, wellfound, generic];

function findAdapter(url) {
  const host = new URL(url).hostname;
  return ADAPTERS.find((a) => a.matches(host));
}

module.exports = { findAdapter, ADAPTERS };
