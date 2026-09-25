const { getCollection } = require('../utils/collectionResolver');
const PhenotypeObservationModel = require('../models/PhenotypeObservation');
const { validateActiveCodes } = require('../ingestion/activeCodeValidator');

/**
 * Persists one PhenotypeObservation (dict-02 ELM-0211..0218 +
 * P1X-0074..0076, #690) referenced by participantId. Same RF005 AC#4
 * active-code reuse as condition.service.js#createCondition -- see that
 * function's doc comment for why this borrows activeCodeValidator rather
 * than ingestionGateway.js's broader envelope.
 */
async function createPhenotypeObservation(db, data) {
  const observation = PhenotypeObservationModel.create(data);

  const codeCheck = await validateActiveCodes(db, [
    {
      systemUri: observation.hpoCoding.systemUri,
      code: observation.hpoCoding.code,
      version: observation.hpoCoding.version || null,
      label: `hpoCoding[${observation.hpoCoding.systemUri}|${observation.hpoCoding.code}]`,
    },
  ]);
  if (!codeCheck.valid) {
    throw new Error(codeCheck.violations.map((v) => v.message).join(', '));
  }

  // RF005 AC#5 ("preservar código, sistema, versão e descrição da
  // terminologia"): the active-release check above already resolved the
  // matched TerminologyConcept's own `version` -- it used to be computed
  // and discarded (#866). Stamp it onto hpoCoding when the caller didn't
  // supply one already; never overwrite an explicitly-given version, and
  // leave the field absent (not null) if the validator couldn't resolve one.
  // Cutoff (#879): codings written before 1d6d10b2 (2026-08-28) carry no
  // version and are deliberately not back-filled, so an absent version on an
  // older row means "written before the cutoff", not "unversioned".
  if (!observation.hpoCoding.version) {
    const resolvedVersion = codeCheck.results[0]?.concept?.version;
    if (resolvedVersion) {
      observation.hpoCoding.version = resolvedVersion;
    }
  }

  const collection = await getCollection(db, 'phenotypeObservations');
  await collection.insertOne(observation);
  return observation;
}

/** All phenotype observations for a participant. */
async function getPhenotypeObservationsForParticipant(db, participantId) {
  const collection = await getCollection(db, 'phenotypeObservations');
  return collection.find({ participantId: String(participantId) }).toArray();
}

/** All phenotype observations recorded within a given encounter (P1X-0075). */
async function getPhenotypeObservationsForEncounter(db, encounterId) {
  if (!encounterId) return [];
  const collection = await getCollection(db, 'phenotypeObservations');
  return collection.find({ encounterId: String(encounterId) }).toArray();
}

module.exports = {
  createPhenotypeObservation,
  getPhenotypeObservationsForParticipant,
  getPhenotypeObservationsForEncounter,
};
