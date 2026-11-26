#!/usr/bin/env node
/**
 * Scaffold converters for SRC_CPATH / SRC_FDA_PGX (PHR-002).
 * Offline only — place dumps under docs/data/ then convert to the same
 * BiomarkerAssociation JSONL shape as MarkerDB. Full parsers land when dumps
 * are attached to the Zenodo pack.
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { source: null, inPath: null, outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') args.source = argv[++i];
    if (argv[i] === '--in') args.inPath = argv[++i];
    if (argv[i] === '--out') args.outPath = argv[++i];
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.source || !args.outPath) {
    process.stderr.write('Usage: convertCpathFdaStub.js --source SRC_CPATH|SRC_FDA_PGX [--in dump] --out out.jsonl\n');
    process.exit(2);
  }
  const outAbs = path.resolve(args.outPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  // Empty JSONL until redistributable dump is staged (ADR 2026-11-25 addendum).
  fs.writeFileSync(outAbs, '');
  process.stdout.write(`${JSON.stringify({
    source: args.source,
    records: 0,
    outPath: outAbs,
    note: 'Stub: attach official dump under docs/data and replace this converter.',
  })}\n`);
}

if (require.main === module) main();

module.exports = { main };
