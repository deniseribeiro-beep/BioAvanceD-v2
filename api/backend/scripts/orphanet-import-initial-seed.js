const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const FILE_SPECS = [
  {
    file: 'orphanet_entities.jsonl',
    collection: 'orphanet_diseases',
    filter: (doc) => ({ system: 'ORPHA', code: doc.code }),
    replaceFilter: (release) => ({ system: 'ORPHA', release }),
    transform: (doc) => ({
      ...doc,
      orphaCode: doc.code,
      ORPHA: doc.canonicalCode,
      name: doc.labels?.pt || doc.labels?.en || doc.code,
      aliases: Array.from(new Set([...(doc.synonyms?.pt || []), ...(doc.synonyms?.en || [])])),
      updatedAt: new Date(),
    }),
  },
  {
    file: 'cids_projection.jsonl',
    collection: 'cids',
    filter: (doc) => ({ system: 'ORPHA', code: doc.code }),
    replaceFilter: (release) => ({ system: 'ORPHA', release }),
    transform: (doc) => ({
      ...doc,
      ORPHA: doc.orphaCode,
      orphaCode: doc.code,
      Codigos_CID10: (doc.icd10Codes || []).join(';'),
      Codigos_ICD11: (doc.icd11Codes || []).join(';'),
      SNOMED_CT: (doc.snomedCtCodes || []).join(';'),
      OMIM: (doc.omimCodes || []).join(';'),
      icd10Codes: doc.icd10Codes || [],
      icd11Codes: doc.icd11Codes || [],
      snomedCtCodes: doc.snomedCtCodes || [],
      omimCodes: doc.omimCodes || [],
      Descricao: doc.label,
      aliases: [],
      updatedAt: new Date(),
    }),
  },
  {
    file: 'terminologies_orpha.jsonl',
    collection: 'terminologies',
    filter: (doc) => ({ system: 'ORPHA', code: doc.code }),
    replaceFilter: (release) => ({ system: 'ORPHA', release }),
    transform: (doc) => ({
      ...doc,
      sistema: 'ORPHA',
      codigo: doc.code,
      descricao: doc.label,
      fonte: doc.source,
      ativo: doc.active !== false,
      updatedAt: new Date(),
    }),
  },
  {
    file: 'terminology_mappings.jsonl',
    collection: 'terminology_mappings',
    filter: (doc) => ({
      sourceSystem: doc.sourceSystem,
      sourceCode: doc.sourceCode,
      targetSystem: doc.targetSystem,
      targetCode: doc.targetCode,
    }),
    replaceFilter: (release) => ({
      sourceSystem: 'ORPHA',
      $or: [{ release }, { orphanetRelease: release }],
    }),
  },
  {
    file: 'orphanet_classifications.jsonl',
    collection: 'orphanet_classifications',
    filter: (doc) => ({
      hchid: doc.hchid,
      orphaCode: doc.orphaCode,
      parentOrphaCode: doc.parentOrphaCode,
      childOrphaCode: doc.childOrphaCode,
      language: doc.language,
    }),
    replaceFilter: (release) => ({ source: 'Orphanet Nomenclature Pack / RD-CODE', release }),
  },
];

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function artifactFile(artifactDir, fileName) {
  return path.join(artifactDir, 'normalized', fileName);
}

function normalizedFileKey(fileName) {
  return `normalized/${fileName}`;
}

function defaultCheckpointFile(artifactDir) {
  return path.join(artifactDir, 'validation', 'import_checkpoint.json');
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function readJsonl(filePath) {
  const text = await fs.promises.readFile(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function readCheckpoint(filePath, enabled, artifactDir, release) {
  if (!enabled || !fs.existsSync(filePath)) {
    return {
      artifactPath: artifactDir,
      release,
      updatedAt: '',
      files: {},
    };
  }
  const checkpoint = await readJson(filePath);
  if (checkpoint.artifactPath && path.resolve(checkpoint.artifactPath) !== path.resolve(artifactDir)) {
    throw new Error(`Checkpoint artifact mismatch: ${checkpoint.artifactPath}`);
  }
  if (checkpoint.release && checkpoint.release !== release) {
    throw new Error(`Checkpoint release mismatch: ${checkpoint.release}`);
  }
  return {
    artifactPath: artifactDir,
    release,
    updatedAt: checkpoint.updatedAt || '',
    files: checkpoint.files || {},
  };
}

async function writeCheckpoint(filePath, checkpoint, enabled) {
  if (!enabled) return;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

async function resetImportCheckpoint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  await fs.promises.unlink(filePath);
  return true;
}

function updateCheckpointFile(checkpoint, spec, fileKey, processedLines, totalLines, completed) {
  const now = new Date().toISOString();
  checkpoint.artifactPath = checkpoint.artifactPath || '';
  checkpoint.updatedAt = now;
  checkpoint.files[fileKey] = {
    collection: spec.collection,
    processedLines,
    totalLines,
    completed,
    lastUpdatedAt: now,
  };
}

function buildOperations(rows, spec) {
  return rows.map((row) => {
    const doc = spec.transform ? spec.transform(row) : row;
    return {
      updateOne: {
        filter: spec.filter(row),
        update: {
          $set: { ...doc, importedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    };
  });
}

function shouldStop(startedAt, maxSeconds) {
  const maxMs = Math.max(Number(maxSeconds) || 220, 1) * 1000;
  return Date.now() - startedAt > Math.max(maxMs - 5000, 1000);
}

async function replaceRelease(db, release) {
  const deleted = {};
  for (const spec of FILE_SPECS) {
    const filter = spec.replaceFilter(release);
    const result = await db.collection(spec.collection).deleteMany(filter);
    deleted[spec.collection] = result.deletedCount;
    console.log(`[orphanet-import-initial-seed] replaceRelease collection=${spec.collection} deleted=${result.deletedCount}`);
  }
  return deleted;
}

async function importFile(db, artifactDir, spec, batchSize, maxSeconds, startedAt, checkpoint, checkpointPath, checkpointEnabled) {
  const filePath = artifactFile(artifactDir, spec.file);
  const fileKey = normalizedFileKey(spec.file);
  if (!fs.existsSync(filePath)) {
    return { skipped: true, reason: 'missing-file', file: spec.file };
  }
  const rows = await readJsonl(filePath);
  const previous = checkpoint.files[fileKey] || {};
  if (previous.completed) {
    console.log(`[orphanet-import] file=${fileKey} collection=${spec.collection} resumeFromLine=${rows.length} completed=true`);
    return {
      file: spec.file,
      fileKey,
      collection: spec.collection,
      processed: rows.length,
      total: rows.length,
      skipped: true,
      reason: 'checkpoint-completed',
      upsertedOrModified: 0,
      safeStop: false,
    };
  }

  let processed = Math.min(Number(previous.processedLines || 0), rows.length);
  let upsertedOrModified = 0;
  let batchNumber = Math.floor(processed / batchSize) + 1;

  console.log(`[orphanet-import] file=${fileKey} collection=${spec.collection} resumeFromLine=${processed}`);
  if (processed >= rows.length) {
    updateCheckpointFile(checkpoint, spec, fileKey, rows.length, rows.length, true);
    await writeCheckpoint(checkpointPath, checkpoint, checkpointEnabled);
    return {
      file: spec.file,
      fileKey,
      collection: spec.collection,
      processed: rows.length,
      total: rows.length,
      skipped: true,
      reason: 'checkpoint-at-eof',
      upsertedOrModified: 0,
      safeStop: false,
    };
  }

  while (processed < rows.length) {
    if (shouldStop(startedAt, maxSeconds)) {
      updateCheckpointFile(checkpoint, spec, fileKey, processed, rows.length, false);
      await writeCheckpoint(checkpointPath, checkpoint, checkpointEnabled);
      console.log('[orphanet-import] safe stop requested by maxSeconds; rerun same command to continue');
      return {
        file: spec.file,
        fileKey,
        collection: spec.collection,
        processed,
        total: rows.length,
        safeStop: true,
      };
    }

    const batch = rows.slice(processed, processed + batchSize);
    if (batch.length) {
      const result = await db.collection(spec.collection).bulkWrite(buildOperations(batch, spec), { ordered: false });
      upsertedOrModified += (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0);
      processed += batch.length;
      updateCheckpointFile(checkpoint, spec, fileKey, processed, rows.length, processed >= rows.length);
      await writeCheckpoint(checkpointPath, checkpoint, checkpointEnabled);
      console.log(`[orphanet-import] file=${fileKey} collection=${spec.collection} batch=${batchNumber} imported=${batch.length} upserted=${result.upsertedCount || 0} matched=${result.matchedCount || 0} modified=${result.modifiedCount || 0}`);
      if (checkpointEnabled) {
        console.log(`[orphanet-import] checkpoint saved processedLines=${processed}`);
      }
      batchNumber += 1;
    }
  }

  return {
    file: spec.file,
    fileKey,
    collection: spec.collection,
    processed,
    total: rows.length,
    upsertedOrModified,
    safeStop: false,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const artifactDir = path.resolve(args.artifact || '');
  if (!artifactDir) throw new Error('Use --artifact <dir>');
  if (!fs.existsSync(artifactDir)) throw new Error(`Artifact not found: ${artifactDir}`);

  const batchSize = Math.max(Number(args.batch || 500), 1);
  const maxSeconds = Math.max(Number(args.maxSeconds || process.env.MAX_SECONDS || 220), 1);
  const manifestPath = path.join(artifactDir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? await readJson(manifestPath) : {};
  const release = args.release || manifest.release || '2025-07';
  const checkpointEnabled = Boolean(args.checkpoint || args.checkpointFile);
  const checkpointPath = path.resolve(args.checkpointFile || defaultCheckpointFile(artifactDir));

  if (args.resetImportCheckpoint) {
    const removed = await resetImportCheckpoint(checkpointPath);
    console.log(`[orphanet-import] reset checkpoint=${checkpointPath} removed=${removed}`);
    return;
  }

  if (args.replaceRelease && !args.confirmReplaceRelease) {
    throw new Error('Refusing --replaceRelease without --confirmReplaceRelease');
  }
  if (args.replaceRelease) {
    const removed = await resetImportCheckpoint(checkpointPath);
    console.log(`[orphanet-import] replaceRelease reset checkpoint=${checkpointPath} removed=${removed}`);
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bioavanced?retryWrites=true&w=majority&tls=false';
  const dbName = process.env.MONGO_DB || process.env.DB_NAME || 'bioavanced';
  const client = new MongoClient(mongoUri);
  const startedAt = Date.now();
  const summary = {
    release,
    artifactDir,
    batchSize,
    maxSeconds,
    checkpoint: checkpointEnabled ? checkpointPath : '',
    replaceRelease: Boolean(args.replaceRelease),
    imported: {},
    safeStop: false,
  };
  const checkpoint = await readCheckpoint(checkpointPath, checkpointEnabled, artifactDir, release);

  await client.connect();
  try {
    const db = client.db(dbName);
    if (args.replaceRelease) {
      checkpoint.files = {};
      checkpoint.updatedAt = new Date().toISOString();
      await writeCheckpoint(checkpointPath, checkpoint, checkpointEnabled);
      summary.deleted = await replaceRelease(db, release);
    }
    for (const spec of FILE_SPECS) {
      const result = await importFile(db, artifactDir, spec, batchSize, maxSeconds, startedAt, checkpoint, checkpointPath, checkpointEnabled);
      summary.imported[spec.collection] = result;
      if (result.safeStop) {
        summary.safeStop = true;
        console.log('[orphanet-import] safe stop before time limit; rerun the same command to continue from checkpoint');
        break;
      }
    }
  } finally {
    await client.close();
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.safeStop) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[orphanet-import-initial-seed] ${error.stack || error.message}`);
  process.exit(1);
});
