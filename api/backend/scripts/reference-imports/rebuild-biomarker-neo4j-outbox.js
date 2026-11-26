#!/usr/bin/env node
/**
 * One-shot: enqueue BIOMARKER_ASSOCIATION_UPSERTED for every Mongo association
 * that has an ORPHA condition (P9=B rebuild path).
 */
require('dotenv').config();
const { connectNewDB, closeConnection } = require('../../src/database/mongo');
const { COLLECTION } = require('../../src/services/biomarkerAssociation.service');
const { GraphProjectionService } = require('../../src/services/graphProjection.service');
const { orphaCodesOf } = require('../../src/reference-data/reference-imports/importBiomarkerAssociations');

async function main() {
  const db = await connectNewDB();
  const graph = new GraphProjectionService();
  const cursor = db.collection(COLLECTION).find({});
  let scanned = 0;
  let enqueued = 0;
  for await (const doc of cursor) {
    scanned += 1;
    for (const orphaCode of orphaCodesOf(doc)) {
      await graph.appendBiomarkerAssociationEvent(db, {
        biomarkerId: doc.biomarkerId,
        orphaCode,
        analyte: doc.analyte,
        biomarkerRole: doc.biomarkerRole,
        contextOfUse: doc.contextOfUse,
        sourceService: 'biomarker-neo4j-rebuild',
      });
      enqueued += 1;
    }
  }
  console.log(JSON.stringify({ scanned, enqueued }, null, 2));
  await closeConnection().catch(() => {});
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
