// HPO graduated to its own operational importer (import-hpo-reference-dataset.js,
// #367) and MONDO to its own (import-mondo-reference-dataset.js, #548) —
// both intentionally no longer listed here.
const allowedDatasets = new Set(['orpha', 'cid', 'omim']);

function parseArgs(argv) {
  const args = { dataset: null, sourceFile: null, dryRun: false };
  for (const token of argv) {
    if (token === '--dry-run') args.dryRun = true;
    else if (token.startsWith('--dataset=')) args.dataset = token.slice('--dataset='.length);
    else if (token.startsWith('--source-file=')) args.sourceFile = token.slice('--source-file='.length);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.dataset && !allowedDatasets.has(args.dataset)) {
    console.error(`Invalid or missing --dataset. Allowed: ${Array.from(allowedDatasets).join(', ')}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    dataset: args.dataset || 'all',
    sourceFile: args.sourceFile || null,
    dryRun: args.dryRun,
    status: 'not implemented until data model is finalized',
  }, null, 2));
  process.exit(0);
}

main();
