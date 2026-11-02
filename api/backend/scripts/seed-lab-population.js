#!/usr/bin/env node
'use strict';

/**
 * BioAvanceD Lab Population Pattern (BLPP) — seed CLI.
 *
 * Usage (inside backend container or with MONGO_URI):
 *   node scripts/seed-lab-population.js --n 100 --seed 4242 --out /tmp/blpp-run
 *   node scripts/seed-lab-population.js --n 100 --seed 4242 --resume --out /tmp/blpp-run
 *   node scripts/seed-lab-population.js --status --out /tmp/blpp-run --run-id <id>
 *   node scripts/seed-lab-population.js --n 2 --seed 1 --dry-run --format json,csv,xlsx --out /tmp/blpp-dry
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const { connectDB, closeConnection } = require('../src/database/mongo');
const { generateLabPopulation, SCHEMA_VERSION } = require('./lab-population/generateLabPopulation');
const { writePopulationFormats } = require('./lab-population/writers');
const {
  createProgress,
  loadProgress,
  saveProgress,
  defaultProgressPath,
  summarizeProgress,
  estimateEta,
} = require('./lab-population/progress');
const { applyPopulation } = require('./lab-population/applyLabPopulation');

function parseArgs(argv) {
  const args = {
    n: null,
    seed: 4242,
    out: path.join(process.cwd(), 'blpp-out'),
    dryRun: false,
    resume: false,
    status: false,
    format: 'script',
    fromChunk: 0,
    stopAfterChunk: null,
    runId: null,
    chunkSize: 100,
    includeNegatives: false,
    includeClinicalSubset: false,
    specimensPerParticipant: 1,
    applyMode: 'auto',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--n') { args.n = Number(next); i += 1; }
    else if (a === '--seed') { args.seed = Number(next); i += 1; }
    else if (a === '--out') { args.out = next; i += 1; }
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--resume') args.resume = true;
    else if (a === '--status') args.status = true;
    else if (a === '--format') { args.format = next; i += 1; }
    else if (a === '--from-chunk') { args.fromChunk = Number(next); i += 1; }
    else if (a === '--stop-after-chunk') { args.stopAfterChunk = Number(next); i += 1; }
    else if (a === '--run-id') { args.runId = next; i += 1; }
    else if (a === '--chunk-size') { args.chunkSize = Number(next); i += 1; }
    else if (a === '--include-negatives') args.includeNegatives = true;
    else if (a === '--include-clinical-subset') args.includeClinicalSubset = true;
    else if (a === '--specimens-per-participant') { args.specimensPerParticipant = Number(next); i += 1; }
    else if (a === '--apply-mode') { args.applyMode = next; i += 1; }
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`BLPP seed-lab-population.js

  --n N                         population size (required unless --status)
  --seed S                      integer seed (default 4242)
  --out DIR                     output/progress directory
  --format script|json|csv|xlsx|json,csv,xlsx
  --dry-run                     generate writers only / plan apply
  --resume                      skip done chunks
  --from-chunk K                start at chunk K
  --stop-after-chunk K          stop cleanly after chunk K
  --status                      print progress.json summary
  --run-id ID                   reuse run id
  --chunk-size N                default 100
  --include-negatives
  --include-clinical-subset
`);
}

function findLatestProgress(outDir) {
  if (!fs.existsSync(outDir)) return null;
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith('progress-') && f.endsWith('.json'));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(path.join(outDir, b)).mtimeMs - fs.statSync(path.join(outDir, a)).mtimeMs);
  return path.join(outDir, files[0]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  fs.mkdirSync(args.out, { recursive: true });

  if (args.status) {
    const progressPath = args.runId
      ? defaultProgressPath(args.out, args.runId)
      : findLatestProgress(args.out);
    if (!progressPath || !fs.existsSync(progressPath)) {
      console.error('[BLPP] no progress file found');
      process.exit(2);
    }
    const progress = loadProgress(progressPath);
    const summary = summarizeProgress(progress);
    console.log(JSON.stringify({ progressPath, summary, progress }, null, 2));
    return;
  }

  if (!Number.isInteger(args.n) || args.n < 1) {
    console.error('[BLPP] --n is required (positive integer)');
    process.exit(2);
  }

  // On --resume, reuse the latest progress runId (and seed/nTarget if present)
  // so we do not invent a new progress file and abandon the previous checkpoint.
  if (args.resume && !args.runId) {
    const latest = findLatestProgress(args.out);
    if (latest) {
      const prior = loadProgress(latest);
      args.runId = prior.runId;
      if (prior.seed != null) args.seed = prior.seed;
      if (prior.nTarget != null) args.n = prior.nTarget;
      if (prior.chunkSize != null) args.chunkSize = prior.chunkSize;
      console.log(`[BLPP] resume reusing runId=${args.runId} from ${latest}`);
    }
  }

  const population = generateLabPopulation({
    seed: args.seed,
    n: args.n,
    chunkSize: args.chunkSize,
    runId: args.runId,
    includeNegatives: args.includeNegatives,
    includeClinicalSubset: args.includeClinicalSubset,
    specimensPerParticipant: args.specimensPerParticipant,
  });

  const metaPath = path.join(args.out, 'population-meta.json');
  fs.writeFileSync(
    metaPath,
    `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      runId: population.runId,
      seed: population.seed,
      nTarget: population.nTarget,
      chunkSize: population.chunkSize,
      generatedAt: population.generatedAt,
    }, null, 2)}\n`
  );

  const formats = String(args.format)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (formats.some((f) => f !== 'script')) {
    const writerFormats = formats.filter((f) => f !== 'script');
    const written = await writePopulationFormats(population, args.out, writerFormats);
    console.log('[BLPP] wrote', written.join(', '));
  }

  if (args.dryRun && !formats.includes('script')) {
    console.log('[BLPP] dry-run writers only — ok');
    return;
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      runId: population.runId,
      nTarget: population.nTarget,
      chunks: population.chunks.length,
      specimens: population.specimens.length,
      schemaVersion: SCHEMA_VERSION,
    }, null, 2));
    return;
  }

  const progressPath = defaultProgressPath(args.out, population.runId);
  let progress = args.resume ? loadProgress(progressPath) : null;
  if (!progress) {
    progress = createProgress({
      runId: population.runId,
      seed: population.seed,
      schemaVersion: SCHEMA_VERSION,
      nTarget: population.nTarget,
      chunkSize: population.chunkSize,
      chunks: population.chunks,
    });
    saveProgress(progressPath, progress);
  }

  const wallStart = Date.now();
  const db = await connectDB();
  try {
    const summary = await applyPopulation(db, population, {
      progress,
      progressPath,
      resume: args.resume,
      fromChunk: args.fromChunk,
      stopAfterChunk: args.stopAfterChunk,
      dryRun: false,
      applyMode: args.applyMode,
      onProgress: ({ chunk, result, summary: s, eta }) => {
        const etaMin = eta.etaSeconds != null ? (eta.etaSeconds / 60).toFixed(1) : '?';
        const elapsedMin = ((Date.now() - wallStart) / 60000).toFixed(1);
        console.log(
          `[BLPP][${new Date().toISOString()}] chunk=${chunk} ` +
            `done=${s.by.done}/${progress.chunks.length} pct=${s.pct}% ` +
            `+p=${result.participantsCreated} +s=${result.specimensCreated} err=${result.errors} ` +
            `elapsed_min=${elapsedMin} eta_min=${etaMin}`
        );
      },
    });

    const elapsedSec = Math.round((Date.now() - wallStart) / 1000);
    console.log(JSON.stringify({
      ok: true,
      runId: population.runId,
      progressPath,
      summary,
      elapsedSec,
    }, null, 2));
  } finally {
    await closeConnection();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[BLPP] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { parseArgs, main };
