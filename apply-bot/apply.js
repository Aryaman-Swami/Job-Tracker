require('dotenv').config();
const { runApply } = require('./lib/run');

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node apply.js <jobId>');
    process.exit(1);
  }
  await runApply(jobId).catch(() => process.exitCode = 1);
}

main();
