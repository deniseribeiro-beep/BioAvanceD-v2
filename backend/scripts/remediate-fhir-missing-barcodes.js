#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { ObjectId } = require('mongodb');
const { connectDB, closeConnection } = require('../src/database/mongo');
const { resolveSourceCollectionName } = require('../src/utils/collectionResolver');

function sanitizeTail(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function buildControlledBarcode(doc, usedBarcodes, year) {
  const seed = doc?.semanticPointers?.mongoSampleId || doc?.sampleID || doc?._id?.toString() || 'UNKNOWN';
  const tailRaw = sanitizeTail(seed);
  const tail = (tailRaw.slice(-10) || 'UNKNOWN').padStart(10, '0');

  let candidate = `CTRL-${year}-${tail}`;
  let sequence = 1;

  while (usedBarcodes.has(candidate)) {
    const suffix = String(sequence).padStart(2, '0');
    candidate = `CTRL-${year}-${tail}-${suffix}`;
    sequence += 1;
  }

  usedBarcodes.add(candidate);
  return candidate;
}

async function run() {
  try {
    const db = await connectDB();
    const fhirCollection = db.collection('samples_fhir');
    const sourceCollectionName = await resolveSourceCollectionName(db, 'samples');
    const sourceCollection = db.collection(sourceCollectionName);
    const year = new Date().getFullYear();

    const existingBarcodeDocs = await fhirCollection
      .find({ barcode: { $exists: true, $nin: [null, ''] } }, { projection: { barcode: 1 } })
      .toArray();
    const usedBarcodes = new Set(existingBarcodeDocs.map((doc) => String(doc.barcode)));

    const missingDocs = await fhirCollection
      .find({ barcode: { $in: [null, ''] } }, { projection: { sampleID: 1, semanticPointers: 1 } })
      .toArray();

    let updatedFhir = 0;
    let updatedLegacy = 0;

    for (const doc of missingDocs) {
      const controlledBarcode = buildControlledBarcode(doc, usedBarcodes, year);

      await fhirCollection.updateOne(
        { _id: doc._id },
        {
          $set: {
            barcode: controlledBarcode,
            updatedAt: new Date(),
            remediation: {
              barcodeGenerated: true,
              strategy: 'controlled-deterministic-id',
              generatedAt: new Date()
            }
          }
        }
      );
      updatedFhir += 1;

      const mongoSampleId = doc?.semanticPointers?.mongoSampleId;
      if (mongoSampleId) {
        const sourceId = ObjectId.isValid(mongoSampleId) ? new ObjectId(mongoSampleId) : mongoSampleId;
        const sourceResult = await sourceCollection.updateOne(
          {
            _id: sourceId,
            $or: [
              { barcode: { $exists: false } },
              { barcode: null },
              { barcode: '' }
            ]
          },
          {
            $set: {
              barcode: controlledBarcode,
              updatedAt: new Date()
            }
          }
        );

        if (sourceResult.modifiedCount > 0) {
          updatedLegacy += 1;
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          status: 'ok',
          sourceCollection: sourceCollectionName,
          totalMissingBefore: missingDocs.length,
          updatedFhir,
          updatedLegacy,
          strategy: `CTRL-${year}-<seed>`
        },
        null,
        2
      )
    );

    process.exit(0);
  } catch (error) {
    console.error('[FHIR_BARCODE_REMEDIATE] Falha na remediação:', error.message || error);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}

run();