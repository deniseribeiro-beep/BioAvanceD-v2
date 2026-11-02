'use strict';

/**
 * BioAvanceD Lab Population Pattern (BLPP) — pure generator (no I/O).
 * REF-032/Synthea is methodological inspiration only; this is a project-native pattern.
 */

const SCHEMA_VERSION = '1.0.0';
const SOURCE_SYSTEM = 'bioavanced-lab-population';

const SAMPLE_TYPES = ['PLASMA', 'SERUM', 'PBMC'];
const SAMPLE_ORIGINS = ['VENOUS_BLOOD', 'CAPILLARY_BLOOD'];
const EXTRACTION_PROTOCOLS = {
  PLASMA: 'TUBE_EDTA',
  SERUM: 'TUBE_SERUM',
  PBMC: 'TUBE_EDTA',
};

/** Deterministic mulberry32 PRNG from integer seed. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function padIndex(i, width = 6) {
  return String(i).padStart(width, '0');
}

function birthDateForIndex(seed, index) {
  const year = 1955 + ((seed + index * 17) % 45);
  const month = 1 + ((seed + index * 3) % 12);
  const day = 1 + ((seed + index * 7) % 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * @param {object} options
 * @param {number} options.seed
 * @param {number} options.n
 * @param {number} [options.specimensPerParticipant=1]
 * @param {boolean} [options.includeClinicalSubset=false]
 * @param {number} [options.clinicalFraction=0.2]
 * @param {boolean} [options.includeNegatives=false]
 * @param {number} [options.chunkSize=100]
 * @param {string} [options.runId]
 */
function generateLabPopulation(options = {}) {
  const seed = Number(options.seed);
  const n = Number(options.n);
  if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
  if (!Number.isInteger(n) || n < 1) throw new Error('n must be a positive integer');

  const specimensPerParticipant = Number(options.specimensPerParticipant ?? 1);
  const includeClinicalSubset = Boolean(options.includeClinicalSubset);
  const clinicalFraction = Number(options.clinicalFraction ?? 0.2);
  const includeNegatives = Boolean(options.includeNegatives);
  const chunkSize = Number(options.chunkSize ?? 100);
  const runId = options.runId || `blpp-${seed}-${n}-${Date.now()}`;
  const rng = mulberry32(seed);

  const participants = [];
  const specimens = [];
  const clinicalSubset = [];

  for (let i = 0; i < n; i += 1) {
    const sourceRecordId = `${seed}:p:${padIndex(i)}`;
    const sex = pick(rng, ['F', 'M']);
    const patientName = `BLPP Paciente ${seed}-${padIndex(i)}`;
    participants.push({
      sourceRecordId,
      patientName,
      birthDate: birthDateForIndex(seed, i),
      sex,
      email: `blpp.${seed}.${padIndex(i)}@example.invalid`,
    });

    for (let s = 0; s < specimensPerParticipant; s += 1) {
      const sampleType = pick(rng, SAMPLE_TYPES);
      specimens.push({
        sourceRecordId: `${seed}:s:${padIndex(i)}:${s}`,
        participantSourceRecordId: sourceRecordId,
        sampleType,
        sampleOrigin: pick(rng, SAMPLE_ORIGINS),
        extractionProtocol: EXTRACTION_PROTOCOLS[sampleType] || 'TUBE_EDTA',
        quantity: 5 + Math.floor(rng() * 20),
        quality: 'GOOD',
        linkedProject: `BLPP-${seed}`,
      });
    }

    if (includeClinicalSubset && rng() < clinicalFraction) {
      clinicalSubset.push({
        sourceRecordId: `${seed}:c:${padIndex(i)}`,
        participantSourceRecordId: sourceRecordId,
        conditionCodeSystem: 'ICD10',
        conditionCode: 'E75.2',
        observationCodeSystem: 'LOINC',
        observationCode: '718-7',
        note: 'clinical-subset-placeholder-remap-at-apply',
      });
    }
  }

  const negatives = includeNegatives
    ? [
        {
          kind: 'invalid_sample_type',
          sampleType: 'NOT_A_REAL_SAMPLE_TYPE',
          sampleOrigin: 'VENOUS_BLOOD',
          extractionProtocol: 'TUBE_EDTA',
          expected: 'reject_or_quarantine',
        },
        {
          kind: 'invalid_origin',
          sampleType: 'PLASMA',
          sampleOrigin: 'NOT_A_REAL_ORIGIN',
          extractionProtocol: 'TUBE_EDTA',
          expected: 'reject_or_quarantine',
        },
        {
          kind: 'missing_consent_participant',
          note: 'specimen against participant without ACTIVE consent',
          expected: 'reject',
        },
      ]
    : [];

  const chunks = [];
  for (let start = 0; start < n; start += chunkSize) {
    const end = Math.min(n, start + chunkSize);
    chunks.push({
      i: chunks.length,
      start,
      end,
      participantSourceRecordIds: participants.slice(start, end).map((p) => p.sourceRecordId),
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    seed,
    generatedAt: new Date().toISOString(),
    sourceSystem: SOURCE_SYSTEM,
    runId,
    nTarget: n,
    chunkSize,
    specimensPerParticipant,
    participants,
    specimens,
    clinicalSubset,
    negatives,
    chunks,
  };
}

module.exports = {
  SCHEMA_VERSION,
  SOURCE_SYSTEM,
  SAMPLE_TYPES,
  SAMPLE_ORIGINS,
  EXTRACTION_PROTOCOLS,
  generateLabPopulation,
  mulberry32,
};
