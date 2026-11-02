'use strict';

/**
 * Applies a BLPP population through project services (patient + identity)
 * plus ACTIVE consent (patientConsents) and sample.service createSample.
 */

const { ObjectId } = require('mongodb');
const patientService = require('../../src/services/patient.service');
const sampleService = require('../../src/services/sample.service');
const { SampleModel } = require('../../src/models/Sample');
const { generateUniqueSpecimenId } = require('../../src/utils/sampleIDGenerator');
const { generateUniqueBarcode } = require('../../src/utils/barcodeGenerator');
const { generateBarcodeSymbologies } = require('../../src/utils/barcodeSymbology');
const { SOURCE_SYSTEM } = require('./generateLabPopulation');
const { markChunk, saveProgress, summarizeProgress, estimateEta } = require('./progress');

const BLPP_MARKER = 'bioavanced-lab-population-v1';

/**
 * Lab compose.dev Mongo is often standalone (no --replSet). RF006 createSample
 * allocation requires transactions. Auto-detect and fall back to lab-direct
 * inserts (same pattern as seed-demo-samples.js) while still using patient.service
 * for LGPD identity — document this in the ex-ante what-if matrix.
 */
async function resolveApplyMode(db, requested = 'auto') {
  if (requested === 'service' || requested === 'lab-direct') return requested;
  try {
    const admin = db.client.db().admin();
    const status = await admin.command({ hello: 1 });
    if (status.setName || status.msg === 'isdbgrid') return 'service';
  } catch (_) {
    /* fall through */
  }
  return 'lab-direct';
}

async function ensureConsentTemplate(db) {
  const templates = db.collection('consent_templates');
  const now = new Date();
  const doc = await templates.findOneAndUpdate(
    { blppFixture: BLPP_MARKER },
    {
      $setOnInsert: {
        title: 'BLPP lab consent template',
        content: 'TCLE sintetico BLPP — apenas laboratorio/tese (VAL-027).',
        version: 'blpp-v1',
        permissions: [],
        createdAt: now,
      },
      $set: { active: true, updatedAt: now, blppFixture: BLPP_MARKER },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return String(doc._id);
}

async function ensureStorageCapacity(db, capacityNeeded) {
  const boxesCol = db.collection('storageBoxes');
  const existing = await boxesCol
    .find({ blppFixture: BLPP_MARKER, status: 'ACTIVE' })
    .toArray();

  let free = 0;
  const freeSlots = [];
  for (const box of existing) {
    const rows = box.dimension?.rows || 0;
    const cols = box.dimension?.cols || 0;
    const grid = box.occupancyGrid || {};
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const pos = `${String.fromCharCode(65 + r)}${c + 1}`;
        if (!grid[pos]) {
          freeSlots.push({ boxId: box._id, positionCode: pos });
          free += 1;
        }
      }
    }
  }

  while (free < capacityNeeded) {
    const suffix = `${Date.now()}-${free}`;
    const rows = 20;
    const cols = 50;
    const containerID = Date.now() + free;
    const now = new Date();
    const freezer = await db.collection('storageContainers').insertOne({
      name: `BLPP freezer ${suffix}`,
      containerType: 'FREEZER',
      containerID,
      status: 'OPERATIONAL',
      parent_id: null,
      blppFixture: BLPP_MARKER,
      createdAt: now,
      updatedAt: now,
    });
    const shelf = await db.collection('storageContainers').insertOne({
      name: `BLPP shelf ${suffix}`,
      containerType: 'SHELF',
      parent_id: freezer.insertedId,
      blppFixture: BLPP_MARKER,
      createdAt: now,
      updatedAt: now,
    });
    const rack = await db.collection('storageContainers').insertOne({
      name: `BLPP rack ${suffix}`,
      containerType: 'RACK',
      parent_id: shelf.insertedId,
      blppFixture: BLPP_MARKER,
      createdAt: now,
      updatedAt: now,
    });
    const box = await boxesCol.insertOne({
      name: `BLPP box ${suffix}`,
      parent_id: rack.insertedId,
      dimension: { rows, cols },
      status: 'ACTIVE',
      occupancyGrid: {},
      currentOccupancy: 0,
      blppFixture: BLPP_MARKER,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('equipment').insertOne({
      equipmentID: containerID,
      status: 'Active',
      equipmentDescription: `BLPP freezer equipment ${suffix}`,
      blppFixture: BLPP_MARKER,
      createdAt: now,
    });
    await db.collection('sensors').insertOne({
      sensorId: `BLPP-sensor-${suffix}`,
      sensorType: 'temperature',
      maintenanceStatus: 'operational',
      status: 'operational',
      locationId: containerID,
      blppFixture: BLPP_MARKER,
      createdAt: now,
    });
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const pos = `${String.fromCharCode(65 + r)}${c + 1}`;
        freeSlots.push({ boxId: box.insertedId, positionCode: pos });
        free += 1;
      }
    }
  }

  return freeSlots;
}

async function findExistingBySource(db, sourceRecordId) {
  const patient = await db.collection('patients').findOne({
    sourceSystem: SOURCE_SYSTEM,
    sourceRecordId,
  });
  return patient;
}

async function applyParticipant(db, participant, consentTemplateId, runId) {
  const existing = await findExistingBySource(db, participant.sourceRecordId);
  if (existing) {
    return { participantId: existing.participantId, created: false };
  }

  const patient = await patientService.createPatient(
    db,
    {
      participantId: 'placeholder',
      patientName: participant.patientName,
      birthDate: participant.birthDate,
      sex: participant.sex,
      email: participant.email,
      consentTemplateId,
    },
    { skipConsentNotification: true, skipBiomarkerArtifacts: true }
  );

  await db.collection('patients').updateOne(
    { _id: patient._id },
    {
      $set: {
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordId: participant.sourceRecordId,
        labPopulationRunId: runId,
        blppFixture: BLPP_MARKER,
        status: 'ACTIVE',
      },
    }
  );

  const consents = db.collection('patientConsents');
  const hasConsent = await consents.findOne({
    participantId: patient.participantId,
    status: 'ACTIVE',
  });
  if (!hasConsent) {
    await consents.insertOne({
      participantId: patient.participantId,
      consentTemplateId: new ObjectId(consentTemplateId),
      status: 'ACTIVE',
      responses: {},
      signedAt: new Date(),
      createdAt: new Date(),
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordId: `${participant.sourceRecordId}:consent`,
      labPopulationRunId: runId,
      blppFixture: BLPP_MARKER,
    });
  }

  return { participantId: patient.participantId, created: true };
}

async function applySpecimenService(db, specimen, participantId, slot, runId) {
  const created = await sampleService.createSample(
    db,
    {
      participantId,
      sampleType: specimen.sampleType,
      sampleOrigin: specimen.sampleOrigin,
      extractionProtocol: specimen.extractionProtocol,
      quantity: specimen.quantity,
      quality: specimen.quality,
      linkedProject: specimen.linkedProject,
      registeredAt: new Date(),
      boxId: String(slot.boxId),
      positionCode: slot.positionCode,
    },
    {}
  );

  await db.collection('samples').updateOne(
    { _id: created._id },
    {
      $set: {
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordId: specimen.sourceRecordId,
        labPopulationRunId: runId,
        blppFixture: BLPP_MARKER,
      },
    }
  );

  return { specimenId: created.specimenId, created: true };
}

async function applySpecimenLabDirect(db, specimen, participantId, slot, runId) {
  const specimenId = String(await generateUniqueSpecimenId(db, 'samples'));
  const barcode = await generateUniqueBarcode(db);
  const position = String(slot.positionCode).trim().toUpperCase();
  const boxObjId = slot.boxId instanceof ObjectId ? slot.boxId : new ObjectId(slot.boxId);

  const sampleData = {
    participantId,
    sampleType: specimen.sampleType,
    sampleOrigin: specimen.sampleOrigin,
    extractionProtocol: specimen.extractionProtocol,
    quantity: specimen.quantity,
    quality: specimen.quality || 'GOOD',
    linkedProject: specimen.linkedProject,
    registeredAt: new Date(),
    specimenId,
    barcode,
    barcodeSymbologies: generateBarcodeSymbologies(barcode),
    storageLocation: { boxId: boxObjId, position },
    specimenStatus: 'available',
  };

  const validation = SampleModel.validate(sampleData);
  if (!validation.isValid) {
    throw new Error(`Sample invalid: ${(validation.errors || []).join(', ')}`);
  }

  const sample = SampleModel.create(sampleData);
  sample.sourceSystem = SOURCE_SYSTEM;
  sample.sourceRecordId = specimen.sourceRecordId;
  sample.labPopulationRunId = runId;
  sample.blppFixture = BLPP_MARKER;
  sample.applyMode = 'lab-direct';

  const result = await db.collection('samples').insertOne(sample);
  await db.collection('storageBoxes').updateOne(
    { _id: boxObjId },
    {
      $set: {
        [`occupancyGrid.${position}`]: result.insertedId,
        updatedAt: new Date(),
      },
      $inc: { currentOccupancy: 1 },
    }
  );

  return { specimenId, created: true };
}

async function applySpecimen(db, specimen, participantId, slot, runId, applyMode) {
  const existing = await db.collection('samples').findOne({
    sourceSystem: SOURCE_SYSTEM,
    sourceRecordId: specimen.sourceRecordId,
  });
  if (existing) {
    return { specimenId: existing.specimenId, created: false };
  }
  if (applyMode === 'service') {
    return applySpecimenService(db, specimen, participantId, slot, runId);
  }
  return applySpecimenLabDirect(db, specimen, participantId, slot, runId);
}

/**
 * Apply one chunk of the population.
 */
async function applyChunk(db, population, chunk, slots, slotCursor, consentTemplateId, progress, progressPath, applyMode) {
  markChunk(progress, chunk.i, {
    status: 'running',
    startedAt: new Date().toISOString(),
    error: null,
  });
  saveProgress(progressPath, progress);

  let participantsCreated = 0;
  let specimensCreated = 0;
  let errors = 0;
  const idMap = {};
  const errorDetails = [];

  try {
    for (let idx = chunk.start; idx < chunk.end; idx += 1) {
      const participant = population.participants[idx];
      const { participantId, created } = await applyParticipant(
        db,
        participant,
        consentTemplateId,
        population.runId
      );
      idMap[participant.sourceRecordId] = participantId;
      if (created) participantsCreated += 1;

      const specs = population.specimens.filter(
        (s) => s.participantSourceRecordId === participant.sourceRecordId
      );
      for (const specimen of specs) {
        const slot = slots[slotCursor.value];
        if (!slot) throw new Error('storage slots exhausted');
        slotCursor.value += 1;
        try {
          const result = await applySpecimen(
            db,
            specimen,
            participantId,
            slot,
            population.runId,
            applyMode
          );
          if (result.created) specimensCreated += 1;
        } catch (err) {
          errors += 1;
          errorDetails.push({
            sourceRecordId: specimen.sourceRecordId,
            message: err.message,
          });
        }
      }
    }

    markChunk(progress, chunk.i, {
      status: errors > 0 && specimensCreated === 0 ? 'failed' : 'done',
      finishedAt: new Date().toISOString(),
      counts: {
        participants: participantsCreated,
        specimens: specimensCreated,
        errors,
      },
      error: errorDetails.length ? errorDetails.slice(0, 5) : null,
      participantIdMap: idMap,
    });
    saveProgress(progressPath, progress);
    return { participantsCreated, specimensCreated, errors, idMap };
  } catch (err) {
    markChunk(progress, chunk.i, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: err.message,
      counts: { participants: participantsCreated, specimens: specimensCreated, errors: errors + 1 },
    });
    saveProgress(progressPath, progress);
    throw err;
  }
}

async function applyPopulation(db, population, options = {}) {
  const {
    progress,
    progressPath,
    resume = false,
    fromChunk = 0,
    stopAfterChunk = null,
    dryRun = false,
    onProgress = null,
    applyMode: requestedMode = 'auto',
  } = options;

  if (dryRun) {
    return {
      dryRun: true,
      nTarget: population.nTarget,
      chunks: population.chunks.length,
      specimens: population.specimens.length,
    };
  }

  const applyMode = await resolveApplyMode(db, requestedMode);
  console.log(`[BLPP] applyMode=${applyMode}`);
  progress.applyMode = applyMode;
  saveProgress(progressPath, progress);

  const consentTemplateId = await ensureConsentTemplate(db);
  const slots = await ensureStorageCapacity(db, population.specimens.length);
  const slotCursor = { value: 0 };
  // skip slots already occupied by prior done chunks roughly by counting done specimens
  const doneSpecimens = progress.chunks
    .filter((c) => c.status === 'done')
    .reduce((acc, c) => acc + (c.counts?.specimens || 0), 0);
  slotCursor.value = Math.min(doneSpecimens, slots.length);

  const startedAtMs = Date.now();
  if (resume) progress.resumedAt = new Date().toISOString();

  for (const chunk of population.chunks) {
    if (chunk.i < fromChunk) continue;
    const state = progress.chunks.find((c) => c.i === chunk.i);
    if (resume && state?.status === 'done') continue;

    const result = await applyChunk(
      db,
      population,
      chunk,
      slots,
      slotCursor,
      consentTemplateId,
      progress,
      progressPath,
      applyMode
    );

    const summary = summarizeProgress(progress);
    const eta = estimateEta(progress, startedAtMs);
    if (typeof onProgress === 'function') {
      onProgress({ chunk: chunk.i, result, summary, eta });
    } else {
      const etaMin = eta.etaSeconds != null ? (eta.etaSeconds / 60).toFixed(1) : '?';
      console.log(
        `[BLPP] chunk=${chunk.i} done=${summary.by.done}/${progress.chunks.length} ` +
          `participants+=${result.participantsCreated} specimens+=${result.specimensCreated} ` +
          `errors=${result.errors} pct=${summary.pct}% eta_min=${etaMin}`
      );
    }

    if (stopAfterChunk != null && chunk.i >= stopAfterChunk) {
      console.log(`[BLPP] stop-after-chunk=${stopAfterChunk}`);
      break;
    }
  }

  return summarizeProgress(progress);
}

module.exports = {
  BLPP_MARKER,
  resolveApplyMode,
  ensureConsentTemplate,
  ensureStorageCapacity,
  applyParticipant,
  applySpecimen,
  applyChunk,
  applyPopulation,
};
