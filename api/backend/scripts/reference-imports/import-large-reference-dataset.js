// HPO graduated to its own operational importer (import-hpo-reference-dataset.js,
// #367), MONDO to its own (import-mondo-reference-dataset.js, #548), ORPHA
// to its own (import-orpha-reference-dataset.js, #549), and ICD-11 to its
// own (import-icd11-reference-dataset.js, #549) — none of these are listed
// here.
//
// The cid token (lowercase, no longer present below) was the original
// shared placeholder for BOTH §7.4 step 4 sources named "CID" in the
// plan's Portuguese text — CID-11 (ICD-11) and CID-10 (ICD-10). Now that
// CID-10 has graduated its own operational script too
// (import-icd10-reference-dataset.js, #549), the token is dropped —
// mirroring HPO/MONDO/ORPHA/ICD-11's own removals above.
const allowedDatasets = new Set(['omim']);

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
