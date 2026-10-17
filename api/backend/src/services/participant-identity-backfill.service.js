const { getCollection } = require('../utils/collectionResolver');
const ParticipantIdentityModel = require('../models/ParticipantIdentity');
const participantIdentityService = require('./participantIdentity.service');
const { decryptValue } = require('../utils/fieldEncryption');

/**
 * #565 — one-time backfill: create a ParticipantIdentity record for any
 * Patient document that predates #363's dual-write (patient.service.js
 * #createPatient has mirrored patientName/birthDate/identityDocument into
 * participantIdentities since #363; anything created before that only has
 * them on the Patient document). Safe to run more than once — a patient
 * that already has a matching ParticipantIdentity (by participantId) is
 * left untouched.
 */
async function backfillParticipantIdentities(db) {
  const patientsCollection = await getCollection(db, 'patients');
  const identityCollection = await getCollection(db, 'participantIdentities');

  const patients = await patientsCollection.find({}).toArray();
  const existingIdentities = await identityCollection.find({}).toArray();
  const existingParticipantIds = new Set(existingIdentities.map((identity) => identity.participantId));

  const summary = { patientsProcessed: 0, identitiesCreated: 0, skippedNoParticipantId: 0, skippedAlreadyPresent: 0 };

  for (const patient of patients) {
    summary.patientsProcessed += 1;

    if (!patient.participantId) {
      summary.skippedNoParticipantId += 1;
      continue;
    }

    if (existingParticipantIds.has(patient.participantId)) {
      summary.skippedAlreadyPresent += 1;
      continue;
    }

    // Scoped to exactly the three fields #565 backfills — patient.email/
    // phone/representative* are out of this issue's scope and, on a Patient
    // document that already went through encryptSensitivePatientFields, may
    // already be nulled-with-ciphertext-sibling; passing the whole document
    // through would copy that null into a fresh ParticipantIdentity record
    // instead of leaving those fields alone.
    const identityDoc = participantIdentityService.encryptIdentityFields(
      ParticipantIdentityModel.create({
        participantId: patient.participantId,
        patientName: patient.patientName,
        birthDate: patient.birthDate,
        identityDocument: patient.identityDocument
      })
    );
    await identityCollection.insertOne(identityDoc);
    existingParticipantIds.add(patient.participantId);
    summary.identitiesCreated += 1;
  }

  return { summary };
}

function normalizeForCompare(field, value) {
  if (value === undefined || value === null || value === '') return null;
  // #1166 slice 4: the contact is compared in its stored spelling -- email
  // lowercased by both models, phone digits-only as normalizeForHash hashes it.
  if (field === 'email' || field === 'representativeEmail') return String(value).trim().toLowerCase() || null;
  if (field === 'phone' || field === 'representativePhone' || field === 'representativeIdentityDocument') {
    return String(value).replace(/\D/g, '') || null;
  }
  if (field === 'representativeName') return String(value).trim() || null;
  // #1111 (and #1109): identityDocument is canonicalized to digits-only at
  // rest for every writer, while a pre-#363 Patient document keeps whatever
  // spelling was typed. Comparing the two verbatim reported drift for every
  // punctuated legacy row. Punctuation is formatting, not identity.
  if (field === 'identityDocument') {
    return participantIdentityService.normalizeIdentityDocument(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  return value;
}

const IDENTITY_FIELDS = ['patientName', 'birthDate', 'identityDocument'];
// #1166: the participant's contact is identity data too (dict-02
// P1X-0352/P1X-0353). Compared separately from the civil fields, because a
// Patient still carrying a contact says nothing about its civil identity.
// #1168: the legal representative's four fields move the same way (dict-02
// P1X-0357..0360).
const CONTACT_FIELDS = [
  'email',
  'phone',
  'representativeName',
  'representativeEmail',
  'representativeIdentityDocument',
  'representativePhone'
];

// #1168: patient.service.js encrypted representativeIdentityDocument on the
// Patient document itself (plaintext nulled), so that one is read back from
// its ciphertext sibling there.
const PATIENT_SIDE_CIPHERTEXT = { representativeIdentityDocument: 'representativeIdentityDocumentEncrypted' };

function patientValue(patient, field) {
  const plain = patient[field];
  if (plain !== undefined && plain !== null && plain !== '') return plain;
  const encryptedField = PATIENT_SIDE_CIPHERTEXT[field];
  if (!encryptedField || !patient[encryptedField]) return null;
  const decrypted = decryptValue(patient[encryptedField]);
  return decrypted === undefined ? null : decrypted;
}

// #1386: an identity update removes the old <field>Encrypted envelope of
// every ciphertext it sets. An empty $unset is refused before MongoDB 5.0,
// so it is sent only when it names a field.
function identityUpdateOf(setDoc) {
  const legacyUnset = participantIdentityService.legacyCiphertextUnset(setDoc);
  return Object.keys(legacyUnset).length > 0 ? { $set: setDoc, $unset: legacyUnset } : { $set: setDoc };
}

/**
 * #1166 slice 4: move the participant's contact off `patients` and onto its
 * ParticipantIdentity record, the only place dict-02 puts it. Safe to run
 * more than once.
 *
 * For each Patient still carrying an email or phone, the Patient copy wins
 * wherever the identity copy differs: before ba9e9f19, updatePatient never
 * mirrored a contact edit to the identity record, so a mismatch there is a
 * stale identity value, not a newer one. The Patient copy is removed only
 * once the identity write succeeded. It stays when there is no identity
 * record to move it to (backfillParticipantIdentities creates those first),
 * and when the identity side refuses the phone as a duplicate.
 *
 * Then every identity record still holding a contact in plaintext, or a
 * phone without a phoneHash (written before slice 1), is re-encrypted, so
 * participant_identities_phone_hash_unique_v1 covers it and the plaintext
 * goes wherever encryptIdentityFields drops it.
 */
async function moveParticipantContactToIdentity(db) {
  const patientsCollection = await getCollection(db, 'patients');
  const identityCollection = await getCollection(db, 'participantIdentities');

  const summary = { contactsMoved: 0, identitiesRehashed: 0, skippedNoIdentity: [], phoneConflicts: [] };
  const isDuplicateKey = (error) => error?.code === 11000;

  const patients = await patientsCollection.find({}).toArray();
  for (const patient of patients) {
    const carried = CONTACT_FIELDS.filter((field) => normalizeForCompare(field, patientValue(patient, field)) !== null);
    if (!patient.participantId || carried.length === 0) continue;

    const identity = await identityCollection.findOne({ participantId: patient.participantId });
    if (!identity) {
      summary.skippedNoIdentity.push(patient.participantId);
      continue;
    }

    const decrypted = participantIdentityService.decryptIdentity(identity);
    const contactUpdate = {};
    for (const field of carried) {
      const value = patientValue(patient, field);
      if (normalizeForCompare(field, value) !== normalizeForCompare(field, decrypted[field])) {
        contactUpdate[field] = field === 'email' || field === 'representativeEmail'
          ? normalizeForCompare(field, value)
          : value;
      }
    }

    if (Object.keys(contactUpdate).length > 0) {
      try {
        await identityCollection.updateOne(
          { participantId: patient.participantId },
          identityUpdateOf({ ...participantIdentityService.encryptIdentityFields(contactUpdate), updatedAt: new Date() })
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        summary.phoneConflicts.push(patient.participantId);
        continue;
      }
    }

    const unset = {};
    for (const field of [...CONTACT_FIELDS, ...Object.values(PATIENT_SIDE_CIPHERTEXT)]) {
      if (Object.prototype.hasOwnProperty.call(patient, field)) unset[field] = '';
    }
    await patientsCollection.updateOne({ _id: patient._id }, { $unset: unset });
    summary.contactsMoved += 1;
  }

  const identities = await identityCollection.find({}).toArray();
  for (const identity of identities) {
    const hasPlaintext = CONTACT_FIELDS.some((field) => normalizeForCompare(field, identity[field]) !== null);
    if (!hasPlaintext) continue;

    const decrypted = participantIdentityService.decryptIdentity(identity);
    const contact = {};
    for (const field of CONTACT_FIELDS) {
      if (normalizeForCompare(field, decrypted[field]) !== null) contact[field] = decrypted[field];
    }
    const reencrypted = participantIdentityService.encryptIdentityFields(contact);
    const encryptedFieldMap = participantIdentityService.getEncryptedFieldMap();
    // A write is owed when a ciphertext is missing, the phoneHash is missing,
    // or encryptIdentityFields would drop a plaintext the record still holds.
    const needsWrite = Object.keys(contact).some(
      (field) => !identity[encryptedFieldMap[field]] || reencrypted[field] !== identity[field]
    ) || (contact.phone !== undefined && !identity.phoneHash);
    if (!needsWrite) continue;

    try {
      await identityCollection.updateOne(
        { participantId: identity.participantId },
        identityUpdateOf({ ...reencrypted, updatedAt: new Date() })
      );
      summary.identitiesRehashed += 1;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      summary.phoneConflicts.push(identity.participantId);
    }
  }

  return { summary };
}

// #1166 slice 4: a contact the Patient still carries must already be on the
// identity record, or removing the Patient copy loses it.
function contactDrifted(patient, decryptedIdentity) {
  return CONTACT_FIELDS.some((field) => {
    const onPatient = normalizeForCompare(field, patientValue(patient, field));
    return onPatient !== null && onPatient !== normalizeForCompare(field, decryptedIdentity[field]);
  });
}

/**
 * #565 — parity check: every Patient document's civil-identity fields must
 * already be represented in ParticipantIdentity before those fields can be
 * safely dropped from Patient (the removal's own precondition — "don't drop
 * data that was never backfilled"). Reports any Patient missing a matching
 * ParticipantIdentity record at all, and separately any whose patientName/
 * birthDate/identityDocument have drifted from the ParticipantIdentity
 * mirror, rather than trusting record existence alone.
 */
async function checkParticipantIdentityParity(db) {
  const patientsCollection = await getCollection(db, 'patients');
  const identityCollection = await getCollection(db, 'participantIdentities');

  const patients = await patientsCollection.find({}).toArray();
  const identities = await identityCollection.find({}).toArray();
  const identityByParticipantId = new Map(identities.map((identity) => [identity.participantId, identity]));

  const missing = [];
  const drifted = [];

  for (const patient of patients) {
    if (!patient.participantId) continue;

    const identity = identityByParticipantId.get(patient.participantId);
    if (!identity) {
      missing.push(patient.participantId);
      continue;
    }

    const decrypted = participantIdentityService.decryptIdentity(identity);

    // #1111: #575 removed patientName/birthDate/identityDocument from the
    // Patient document entirely, so for every patient created since there
    // is nothing on the Patient side to compare -- and comparing anyway
    // reported drift for all of them, which meant isFullParity could never
    // be true on a live database and the gate #574 depends on could never
    // open. Compare only the fields this Patient actually still carries.
    const legacyFields = IDENTITY_FIELDS.filter(
      (field) => normalizeForCompare(field, patient[field]) !== null
    );

    if (legacyFields.length === 0) {
      // Nothing was ever on this Patient to drop, so the precondition is
      // about the mirror alone: it must exist and actually hold a civil
      // identity. "Exists and decrypts" is NOT enough -- backfill above
      // creates an all-null record for a post-#575 Patient (fieldsOf nulls
      // every absent field and create() only requires participantId), and
      // calling that parity would open the gate on data that was never
      // backfilled, which is exactly what this check exists to prevent.
      // patientName is the criterion because it is the one field every
      // writer must supply -- patient.service.js#createPatient rejects a
      // missing patientName outright and matchOrUpsertParticipant defaults
      // it to 'PACIENTE SEM NOME'.
      if (normalizeForCompare('patientName', decrypted.patientName) === null
        || contactDrifted(patient, decrypted)) {
        drifted.push(patient.participantId);
      }
      continue;
    }

    const fieldsMatch = legacyFields.every(
      (field) => normalizeForCompare(field, patient[field]) === normalizeForCompare(field, decrypted[field])
    );
    if (!fieldsMatch || contactDrifted(patient, decrypted)) {
      drifted.push(patient.participantId);
    }
  }

  return {
    isFullParity: missing.length === 0 && drifted.length === 0,
    totalPatients: patients.length,
    missing,
    drifted
  };
}

module.exports = { backfillParticipantIdentities, checkParticipantIdentityParity, moveParticipantContactToIdentity };
