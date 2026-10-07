const { getCollection } = require('../utils/collectionResolver');
const { generateUniqueParticipantId } = require('../utils/patientAnonymization');
// Named distinctly from this file's own `participantIdentityService` class
// below (a pre-existing, unrelated same-name collision between the two
// files -- see participantIdentity.service.js's own top-of-file comment).
const identityCryptoService = require('./participantIdentity.service');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeName(value) {
  return normalizeString(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

function parseBirthDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = normalizeString(value);
  if (!raw) return null;

  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]) - 1;
    const year = Number(ddmmyyyy[3]);
    const date = new Date(year, month, day);
    if (!Number.isNaN(date.getTime()) && date.getDate() === day && date.getMonth() === month && date.getFullYear() === year) {
      return date;
    }
  }

  const iso = new Date(raw);
  if (Number.isNaN(iso.getTime())) return null;
  return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate());
}

class participantIdentityService {
  async matchOrUpsertParticipant(db, payload = {}) {
    const participants = await getCollection(db, 'patients');
    const identities = await getCollection(db, 'participantIdentities');
    const participantId = normalizeString(payload.participantId);
    const patientName = normalizeString(payload.patientName);
    const birthDate = parseBirthDate(payload.birthDate);
    const normalizedName = normalizeName(patientName);
    const identityDocument = normalizeString(payload.identityDocument);
    const email = normalizeString(payload.email);
    const phone = normalizeString(payload.phone);
    // #1166: lowercased like every other identity-side email writer
    // (ParticipantIdentityModel.fieldsOf), so the ciphertext holds one spelling.
    const normalizedEmail = email ? email.toLowerCase() : email;
    const sex = normalizeString(payload.sex);
    const cpf = normalizeString(payload.cpf);
    // #703: a caller-supplied participantId that isn't a real 8-digit id
    // (e.g. the intake wizard's 'placeholder', sent for every new patient
    // per #699's precedent) must be treated the same as no participantId at
    // all -- not accepted as a literal id to look up or insert verbatim.
    const validParticipantId = /^\d{8}$/.test(participantId) ? participantId : null;

    if (!validParticipantId && (!normalizedName || !birthDate)) {
      throw new Error('Identificação insuficiente: informe participantId ou (patientName + birthDate).');
    }

    // RF005/RNF007 (#561): resolve the name+birthDate match via
    // ParticipantIdentity, not Patient's own patientNameNormalized/
    // birthDateKey fields, which no longer land on Patient (#575).
    let matchedParticipantId = validParticipantId;
    const matchedBySuppliedId = Boolean(validParticipantId);
    if (!matchedParticipantId) {
      const startOfDay = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());
      const endOfDay = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), startOfDay.getDate() + 1);
      // RF005/RNF007 (#574, done for this field in #1104): birthDate is
      // ciphertext-only, so this narrows by day of birth on the blind index
      // alone. The plaintext range condition below is NOT a fallback for old
      // records -- it is the keyless-stack branch (#1083), reached only when
      // no ENCRYPTION_KEY is configured and the plaintext is therefore the
      // only thing that was written.
      // #1099: match under EVERY registered key, so a hash written before
      // an ENCRYPTION_KEY rotation stays matchable.
      const birthDateHashes = identityCryptoService.computeBlindIndexCandidates('birthDate', birthDate);
      const dateOrConditions = birthDateHashes.length
        ? [{ birthDateHash: { $in: birthDateHashes } }]
        : [{ birthDate: { $gte: startOfDay, $lt: endOfDay } }];
      const candidates = await identities.find({ $or: dateOrConditions }).toArray();
      const matchedIdentity = candidates.find((rawCandidate) => {
        // patientName is civil identity and ciphertext-only (#1104), so
        // decrypt before comparing.
        const candidate = identityCryptoService.decryptIdentity(rawCandidate);
        return normalizeName(candidate.patientName) === normalizedName;
      });
      if (matchedIdentity) {
        matchedParticipantId = matchedIdentity.participantId;
      }
    }

    const existing = matchedParticipantId
      ? await participants.findOne({ participantId: matchedParticipantId })
      : null;

    if (existing) {
      // RF005/RNF007 (#575): patientName/birthDate/identityDocument (plus the
      // patientNameNormalized/birthDateKey helper fields, which only ever
      // existed to support matching against Patient — matching above already
      // resolves via `identities`, so they're dead weight too) never land on
      // Patient. Only non-identity fields get persisted there.
      // #1113: these fallbacks used to read off `existing`, which is a
      // PATIENTS document -- and since #575 a Patient carries no
      // patientName/birthDate/identityDocument at all. So every fallback
      // resolved to undefined and an id-only call (import-lgpd.service.js
      // names its participant by participantId and carries no civil-identity
      // columns) overwrote all three stored plaintext values with null.
      // The mirror is the collection these values actually live in, so read
      // the fallbacks from there, decrypted -- which is what the code always
      // meant. It stayed invisible because the ciphertext and blind-index
      // siblings survived the null write, so decryptIdentity recovered the
      // real values and nothing observable broke (#1113 records that in
      // full, and it is the same accident #1104 relies on as evidence).
      const existingIdentity = identityCryptoService.decryptIdentity(
        await identities.findOne({ participantId: matchedParticipantId })
      ) || {};
      // Omit a field that resolves to nothing rather than writing null over
      // a stored value: a caller that supplies nothing must change nothing.
      const identityValues = {};
      // #1166 slice 4: plus the contact, which is identity data and lives
      // only on this record now.
      const resolvedIdentity = {
        patientName: patientName || existingIdentity.patientName,
        birthDate: birthDate || existingIdentity.birthDate,
        identityDocument: identityDocument || existingIdentity.identityDocument,
        email: normalizedEmail || existingIdentity.email,
        phone: phone || existingIdentity.phone,
      };
      for (const [identityField, resolvedValue] of Object.entries(resolvedIdentity)) {
        if (resolvedValue !== null && resolvedValue !== undefined && resolvedValue !== '') {
          identityValues[identityField] = resolvedValue;
        }
      }
      // #640: route through encryptIdentityFields so this write gets the same
      // ciphertext/hash siblings every other participantIdentities writer
      // produces (#566/#574), not plaintext-only.
      const encryptedIdentityValues = identityCryptoService.encryptIdentityFields(identityValues);
      const update = {
        sex: sex || existing.sex || null,
        cpf: cpf || existing.cpf || null,
        updatedAt: new Date()
      };
      await participants.updateOne({ _id: existing._id }, { $set: update });
      await identities.updateOne(
        { participantId: matchedParticipantId },
        {
          $set: {
            ...encryptedIdentityValues,
            updatedAt: update.updatedAt,
          },
        },
        { upsert: true }
      );
      return { created: false, matchType: matchedBySuppliedId ? 'participantId' : 'name+birthDate', patient: { ...existing, ...update, ...identityValues, participantId: existing.participantId || matchedParticipantId } };
    }

    const generatedParticipantId = validParticipantId || await generateUniqueParticipantId(db);
    const identityValues = {
      patientName: patientName || 'PACIENTE SEM NOME',
      birthDate: birthDate || null,
      identityDocument: identityDocument || null,
    };
    // #1166 slice 4: the contact goes to the identity record only.
    if (normalizedEmail) identityValues.email = normalizedEmail;
    if (phone) identityValues.phone = phone;
    // #640: same rationale as the update branch above.
    const encryptedIdentityValues = identityCryptoService.encryptIdentityFields(identityValues);
    const toInsert = {
      participantId: generatedParticipantId,
      sex: sex || null,
      cpf: cpf || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await participants.insertOne(toInsert);
    await identities.updateOne(
      { participantId: generatedParticipantId },
      {
        $set: {
          participantId: generatedParticipantId,
          ...encryptedIdentityValues,
          updatedAt: toInsert.updatedAt,
        },
      },
      { upsert: true }
    );
    return { created: true, matchType: 'new', patient: { _id: result.insertedId, ...toInsert, ...identityValues } };
  }
}

module.exports = new participantIdentityService();

