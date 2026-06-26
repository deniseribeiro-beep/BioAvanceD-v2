const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

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

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function readFirstJsonl(filePath) {
  const text = await fs.promises.readFile(filePath, 'utf8');
  const line = text.split(/\r?\n/).find(Boolean);
  return line ? JSON.parse(line) : null;
}

async function readJsonl(filePath) {
  const text = await fs.promises.readFile(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function count(db, collectionName, filter) {
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (!collections.length) return 0;
  return db.collection(collectionName).countDocuments(filter);
}

async function main() {
  const args = parseArgs(process.argv);
  const artifactDir = path.resolve(args.artifact || '');
  if (!artifactDir) throw new Error('Use --artifact <dir>');

  const manifest = await readJson(path.join(artifactDir, 'manifest.json'));
  const normalizedCounts = await readJson(path.join(artifactDir, 'validation', 'normalized_counts.json'));
  const artifactMappings = await readJsonl(path.join(artifactDir, 'normalized', 'terminology_mappings.jsonl'));
  const release = args.release || manifest.release || '2025-07';
  const sample = await readFirstJsonl(path.join(artifactDir, 'normalized', 'orphanet_entities.jsonl'));
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bioavanced?retryWrites=true&w=majority&tls=false';
  const dbName = process.env.MONGO_DB || process.env.DB_NAME || 'bioavanced';
  const client = new MongoClient(mongoUri);
  const errors = [];
  const warnings = [];

  await client.connect();
  try {
    const db = client.db(dbName);
    const counts = {
      orphanetDiseasesOrpha: await count(db, 'orphanet_diseases', { system: 'ORPHA', release }),
      cidsOrpha: await count(db, 'cids', { system: 'ORPHA', release }),
      terminologiesOrpha: await count(db, 'terminologies', { system: 'ORPHA', release }),
      icd10Mappings: await count(db, 'terminology_mappings', { sourceSystem: 'ORPHA', targetSystem: 'ICD10', $or: [{ release }, { orphanetRelease: release }] }),
      icd11Mappings: await count(db, 'terminology_mappings', { sourceSystem: 'ORPHA', targetSystem: 'ICD11', $or: [{ release }, { orphanetRelease: release }] }),
      snomedCtMappings: await count(db, 'terminology_mappings', { sourceSystem: 'ORPHA', targetSystem: 'SNOMED_CT', $or: [{ release }, { orphanetRelease: release }] }),
      omimMappings: await count(db, 'terminology_mappings', { sourceSystem: 'ORPHA', targetSystem: 'OMIM', $or: [{ release }, { orphanetRelease: release }] }),
      cidsWithIcd10: await count(db, 'cids', { system: 'ORPHA', release, icd10Codes: { $exists: true, $ne: [] } }),
      cidsWithIcd11: await count(db, 'cids', { system: 'ORPHA', release, icd11Codes: { $exists: true, $ne: [] } }),
      cidsWithSnomedCt: await count(db, 'cids', { system: 'ORPHA', release, snomedCtCodes: { $exists: true, $ne: [] } }),
      cidsWithOmim: await count(db, 'cids', { system: 'ORPHA', release, omimCodes: { $exists: true, $ne: [] } }),
      hpoAsOrpha: await count(db, 'terminologies', { system: 'ORPHA', code: /^HP:/i }),
      biomarkerAsOrpha: await count(db, 'terminologies', { system: 'ORPHA', domain: /biomarker|biomarcador/i }),
    };
    const artifactMappingCounts = {
      icd10Mappings: artifactMappings.filter((row) => row.targetSystem === 'ICD10').length,
      icd11Mappings: artifactMappings.filter((row) => row.targetSystem === 'ICD11').length,
      snomedCtMappings: artifactMappings.filter((row) => row.targetSystem === 'SNOMED_CT').length,
      omimMappings: artifactMappings.filter((row) => row.targetSystem === 'OMIM').length,
    };

    if (counts.orphanetDiseasesOrpha !== normalizedCounts.orphanet_entities) {
      errors.push(`orphanet_diseases ORPHA count mismatch: db=${counts.orphanetDiseasesOrpha}, artifact=${normalizedCounts.orphanet_entities}`);
    }
    if (counts.cidsOrpha !== normalizedCounts.cids_projection) {
      errors.push(`cids ORPHA count mismatch: db=${counts.cidsOrpha}, artifact=${normalizedCounts.cids_projection}`);
    }
    if (counts.terminologiesOrpha !== normalizedCounts.terminologies_orpha) {
      errors.push(`terminologies ORPHA count mismatch: db=${counts.terminologiesOrpha}, artifact=${normalizedCounts.terminologies_orpha}`);
    }

    const mappingRows = await db.collection('terminology_mappings').countDocuments({ sourceSystem: 'ORPHA', $or: [{ release }, { orphanetRelease: release }] });
    if (mappingRows !== normalizedCounts.terminology_mappings) {
      errors.push(`terminology_mappings count mismatch: db=${mappingRows}, artifact=${normalizedCounts.terminology_mappings}`);
    }
    if (!counts.icd10Mappings) warnings.push('No ICD-10 mappings found after import');
    if (!counts.icd11Mappings) warnings.push('No ICD-11 mappings found after import');
    if (!counts.snomedCtMappings) warnings.push('No SNOMED_CT mappings found after import');
    if (artifactMappingCounts.icd10Mappings && counts.icd10Mappings !== artifactMappingCounts.icd10Mappings) {
      errors.push(`ICD10 mapping count mismatch: db=${counts.icd10Mappings}, artifact=${artifactMappingCounts.icd10Mappings}`);
    }
    if (artifactMappingCounts.icd11Mappings && counts.icd11Mappings !== artifactMappingCounts.icd11Mappings) {
      errors.push(`ICD11 mapping count mismatch: db=${counts.icd11Mappings}, artifact=${artifactMappingCounts.icd11Mappings}`);
    }
    if (artifactMappingCounts.snomedCtMappings && counts.snomedCtMappings !== artifactMappingCounts.snomedCtMappings) {
      errors.push(`SNOMED_CT mapping count mismatch: db=${counts.snomedCtMappings}, artifact=${artifactMappingCounts.snomedCtMappings}`);
    }
    if (artifactMappingCounts.omimMappings && counts.omimMappings !== artifactMappingCounts.omimMappings) {
      errors.push(`OMIM mapping count mismatch: db=${counts.omimMappings}, artifact=${artifactMappingCounts.omimMappings}`);
    }
    if (artifactMappingCounts.omimMappings && !counts.cidsWithOmim) {
      errors.push('OMIM mappings exist but no cids documents have omimCodes');
    }
    if (!counts.cidsWithIcd10) warnings.push('No cids documents with icd10Codes');
    if (!counts.cidsWithIcd11) warnings.push('No cids documents with icd11Codes');
    if (!counts.cidsWithSnomedCt) warnings.push('No cids documents with snomedCtCodes');
    if (counts.hpoAsOrpha) errors.push(`HPO terms incorrectly imported as ORPHA: ${counts.hpoAsOrpha}`);
    if (counts.biomarkerAsOrpha) errors.push(`Biomarkers incorrectly imported as ORPHA: ${counts.biomarkerAsOrpha}`);

    if (sample?.code) {
      const sampleHits = {
        orphanet_diseases: await count(db, 'orphanet_diseases', { system: 'ORPHA', code: sample.code, release }),
        cids: await count(db, 'cids', { system: 'ORPHA', code: sample.code, release }),
        terminologies: await count(db, 'terminologies', { system: 'ORPHA', code: sample.code, release }),
      };
      if (!sampleHits.orphanet_diseases || !sampleHits.cids || !sampleHits.terminologies) {
        errors.push(`Sample ORPHA search failed for ${sample.code}: ${JSON.stringify(sampleHits)}`);
      }
      counts.sampleCode = sample.code;
      counts.sampleHits = sampleHits;
    } else {
      errors.push('No sample ORPHA entity found in artifact');
    }

    const report = {
      status: errors.length ? 'FAIL' : 'PASS',
      generatedAt: new Date().toISOString(),
      release,
      counts,
      errors,
      warnings,
    };

    if (errors.length) {
      console.error(JSON.stringify(report, null, 2));
      process.exit(1);
    }
    console.log('[orphanet-validate-imported-seed] PASS');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[orphanet-validate-imported-seed] ${error.stack || error.message}`);
  process.exit(1);
});
