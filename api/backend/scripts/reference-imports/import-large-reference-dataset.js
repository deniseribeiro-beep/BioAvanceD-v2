// HPO graduated to its own operational importer (import-hpo-reference-dataset.js,
// #367), MONDO to its own (import-mondo-reference-dataset.js, #548), and
// ORPHA to its own (import-orpha-reference-dataset.js, #549) — all three
// intentionally no longer listed here.
//
// 'cid' stays listed even though ICD-11 also graduated this slice
// (import-icd11-reference-dataset.js, #549): the original token was one
// placeholder standing in for BOTH §7.4 step 4 sources named "CID" in the
// plan's Portuguese text — CID-11 (ICD-11, now operational) and CID-10
// (ICD-10, not yet built). Removing 'cid' now would read as "CID-10 has
// its own importer too," which isn't true yet — it stays until CID-10
// graduates its own script, at which point 'cid' can finally be dropped.
const allowedDatasets = new Set(['cid', 'omim']);

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
