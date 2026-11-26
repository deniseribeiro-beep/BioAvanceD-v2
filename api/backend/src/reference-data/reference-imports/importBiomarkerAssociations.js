const fs = require('fs');
const path = require('path');
const readline = require('readline');
const BiomarkerAssociationModel = require('../../models/BiomarkerAssociation');
const { COLLECTION } = require('../../services/biomarkerAssociation.service');
const { GraphProjectionService } = require('../../services/graphProjection.service');

/**
 * SRC_MARKERDB → Mongo `biomarkerAssociations` (ELM-0275..0285) + outbox
 * BIOMARKER_ASSOCIATION_UPSERTED for each ORPHA-linked pair (ADR 2026-11-26).
 */
const DEFAULT_FIXTURE = path.join(__dirname, 'fixtures', 'biomarker-associations-sample.jsonl');
const ORPHA_URI = 'http://www.orpha.net';

async function readJsonl(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const rows = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function orphaCodesOf(doc) {
  return (Array.isArray(doc.associatedCondition) ? doc.associatedCondition : [])
    .filter((c) => c && c.systemUri === ORPHA_URI && c.code)
    .map((c) => String(c.code).replace(/^ORPHA:/i, ''));
}

/**
 * @param {import('mongodb').Db} db
 * @param {{ fixturePath?: string, dryRun?: boolean, graphProjection?: GraphProjectionService }} [opts]
 */
async function runBiomarkerAssociationImport(db, opts = {}) {
  const fixturePath = opts.fixturePath || DEFAULT_FIXTURE;
  const dryRun = Boolean(opts.dryRun);
  const raw = await readJsonl(fixturePath);
  const coll = db.collection(COLLECTION);
  const graph = opts.graphProjection || new GraphProjectionService();

  let inserted = 0;
  let updated = 0;
  let rejected = 0;
  let outboxEnqueued = 0;
  const rejections = [];

  for (const record of raw) {
    const fields = BiomarkerAssociationModel.fieldsOf(record);
    if (record.biomarkerId) fields.biomarkerId = String(record.biomarkerId).trim();
    if (record.sourceDataset) fields.sourceDataset = record.sourceDataset;
    const { isValid, errors } = BiomarkerAssociationModel.validate(fields);
    if (!isValid) {
      rejected += 1;
      rejections.push({ biomarkerId: fields.biomarkerId, errors });
      continue;
    }

    const doc = {
      ...fields,
      sourceId: record.sourceId || 'SRC_MARKERDB',
      updatedAt: new Date(),
    };

    if (dryRun) {
      const existing = await coll.findOne({ biomarkerId: doc.biomarkerId }, { projection: { _id: 1 } });
      if (existing) updated += 1;
      else inserted += 1;
      outboxEnqueued += orphaCodesOf(doc).length;
      continue;
    }

    const result = await coll.updateOne(
      { biomarkerId: doc.biomarkerId },
      {
        $set: doc,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) inserted += 1;
    else if (result.matchedCount > 0) updated += 1;

    for (const orphaCode of orphaCodesOf(doc)) {
      await graph.appendBiomarkerAssociationEvent(db, {
        biomarkerId: doc.biomarkerId,
        orphaCode,
        analyte: doc.analyte,
        biomarkerRole: doc.biomarkerRole,
        contextOfUse: doc.contextOfUse,
        sourceService: 'biomarker-association-import',
      });
      outboxEnqueued += 1;
    }
  }

  return {
    dataset: 'BIOMARKER_ASSOCIATIONS',
    sourceId: 'SRC_MARKERDB',
    fixturePath,
    dryRun,
    recordsRead: raw.length,
    recordsInserted: inserted,
    recordsUpdated: updated,
    recordsRejected: rejected,
    outboxEnqueued,
    rejections: rejections.slice(0, 50),
  };
}

module.exports = {
  DEFAULT_FIXTURE,
  readJsonl,
  runBiomarkerAssociationImport,
  orphaCodesOf,
};
