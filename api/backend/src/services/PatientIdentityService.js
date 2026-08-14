const { getCollection } = require('../utils/collectionResolver');
const { generateUniqueParticipantId } = require('../utils/patientAnonymization');

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
    const sex = normalizeString(payload.sex);
    const cpf = normalizeString(payload.cpf);

    if (!participantId && (!normalizedName || !birthDate)) {
      throw new Error('Identificação insuficiente: informe participantId ou (patientName + birthDate).');
    }

    // RF005/RNF007 (#561): resolve the name+birthDate match via
    // ParticipantIdentity, not Patient's own (soon to be removed)
    // patientNameNormalized/birthDateKey fields.
    let matchedParticipantId = participantId || null;
    if (!matchedParticipantId) {
      const startOfDay = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());
      const endOfDay = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), startOfDay.getDate() + 1);
      const candidates = await identities.find({ birthDate: { $gte: startOfDay, $lt: endOfDay } }).toArray();
      const matchedIdentity = candidates.find((candidate) => normalizeName(candidate.patientName) === normalizedName);
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
      const identityValues = {
        patientName: patientName || existing.patientName,
        birthDate: birthDate || existing.birthDate,
        identityDocument: identityDocument || existing.identityDocument || null,
      };
      const update = {
        email: email || existing.email || null,
        phone: phone || existing.phone || null,
        sex: sex || existing.sex || null,
        cpf: cpf || existing.cpf || null,
        updatedAt: new Date()
      };
      await participants.updateOne({ _id: existing._id }, { $set: update });
      await identities.updateOne(
        { participantId: matchedParticipantId },
        {
          $set: {
            patientName: identityValues.patientName,
            birthDate: identityValues.birthDate,
            identityDocument: identityValues.identityDocument,
            email: update.email,
            phone: update.phone,
            updatedAt: update.updatedAt,
          },
        },
        { upsert: true }
      );
      return { created: false, matchType: participantId ? 'participantId' : 'name+birthDate', patient: { ...existing, ...update, ...identityValues, participantId: existing.participantId || participantId } };
    }

    const generatedParticipantId = participantId || await generateUniqueParticipantId(db);
    const identityValues = {
      patientName: patientName || 'PACIENTE SEM NOME',
      birthDate: birthDate || null,
      identityDocument: identityDocument || null,
    };
    const toInsert = {
      participantId: generatedParticipantId,
      email: email || null,
      phone: phone || null,
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
          patientName: identityValues.patientName,
          birthDate: identityValues.birthDate,
          identityDocument: identityValues.identityDocument,
          email: toInsert.email,
          phone: toInsert.phone,
          updatedAt: toInsert.updatedAt,
        },
      },
      { upsert: true }
    );
    return { created: true, matchType: 'new', patient: { _id: result.insertedId, ...toInsert, ...identityValues } };
  }
}

module.exports = new participantIdentityService();

