#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { connectDB, closeConnection } = require('../src/database/mongo');
const { resolveSourceCollectionName } = require('../src/utils/collectionResolver');
const { ObjectId } = require('mongodb');

async function run() {
  try {
    const db = await connectDB();
    const collection = db.collection('samples_fhir');

    const total = await collection.countDocuments({});
    const withBarcode = await collection.countDocuments({
      barcode: { $exists: true, $nin: [null, ''] }
    });

    const uniqueBarcodeResult = await collection
      .aggregate([
        { $match: { barcode: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$barcode' } },
        { $count: 'count' }
      ])
      .toArray();

    const uniqueBarcodes = uniqueBarcodeResult[0]?.count || 0;
    const withoutBarcode = total - withBarcode;
    const coveragePct = total > 0 ? Number(((withBarcode / total) * 100).toFixed(2)) : 0;

    const missingDocs = await collection
      .find({ barcode: { $in: [null, ''] } }, { projection: { sampleID: 1, patientID: 1, semanticPointers: 1 } })
      .limit(10)
      .toArray();

    const sampleSourceName = await resolveSourceCollectionName(db, 'samples');
    const sampleSourceCollection = db.collection(sampleSourceName);

    let missingFoundInLegacyWithBarcode = 0;
    for (const doc of missingDocs) {
      const mongoSampleId = doc?.semanticPointers?.mongoSampleId;
      if (!mongoSampleId) continue;
      const legacyId = ObjectId.isValid(mongoSampleId) ? new ObjectId(mongoSampleId) : mongoSampleId;
      const legacy = await sampleSourceCollection.findOne(
        { _id: legacyId },
        { projection: { barcode: 1 } }
      );
      if (legacy?.barcode !== undefined && legacy?.barcode !== null && String(legacy.barcode).trim() !== '') {
        missingFoundInLegacyWithBarcode += 1;
      }
    }

    console.log(
      JSON.stringify(
        {
          collection: 'samples_fhir',
          sourceCollection: sampleSourceName,
          total,
          withBarcode,
          withoutBarcode,
          uniqueBarcodes,
          coveragePct,
          missingBarcodeSample: missingDocs.map((doc) => ({
            sampleID: doc.sampleID || null,
            patientID: doc.patientID || null,
            mongoSampleId: doc?.semanticPointers?.mongoSampleId || null
          })),
          diagnostics: {
            sampledMissingChecked: missingDocs.length,
            sampledMissingFoundInLegacyWithBarcode: missingFoundInLegacyWithBarcode
          }
        },
        null,
        2
      )
    );

    process.exit(0);
  } catch (error) {
    console.error('[FHIR_BARCODE_COVERAGE] Falha ao calcular cobertura:', error.message || error);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}

run();