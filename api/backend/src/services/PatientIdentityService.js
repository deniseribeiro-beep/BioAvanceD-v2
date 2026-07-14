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

    const matchFilter = participantId
      ? { participantId }
      : { patientNameNormalized: normalizedName, birthDateKey: birthDate.toISOString().slice(0, 10) };

    const existing = await participants.findOne(matchFilter);
    if (existing) {
      const update = {
        patientName: patientName || existing.patientName,
        patientNameNormalized: normalizedName || existing.patientNameNormalized,
        birthDate: birthDate || existing.birthDate,
        birthDateKey: birthDate ? birthDate.toISOString().slice(0, 10) : existing.birthDateKey,
        identityDocument: identityDocument || existing.identityDocument || null,
        email: email || existing.email || null,
        phone: phone || existing.phone || null,
        sex: sex || existing.sex || null,
        cpf: cpf || existing.cpf || null,
        updatedAt: new Date()
      };
      await participants.updateOne({ _id: existing._id }, { $set: update });
      return { created: false, matchType: participantId ? 'participantId' : 'name+birthDate', patient: { ...existing, ...update, participantId: existing.participantId || participantId } };
    }

    const generatedParticipantId = participantId || await generateUniqueParticipantId(db);
    const toInsert = {
      participantId: generatedParticipantId,
      patientName: patientName || 'PACIENTE SEM NOME',
      patientNameNormalized: normalizedName || normalizeName(patientName || 'PACIENTE SEM NOME'),
      birthDate: birthDate || null,
      birthDateKey: birthDate ? birthDate.toISOString().slice(0, 10) : '',
      identityDocument: identityDocument || null,
      email: email || null,
      phone: phone || null,
      sex: sex || null,
      cpf: cpf || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await participants.insertOne(toInsert);
    return { created: true, matchType: 'new', patient: { _id: result.insertedId, ...toInsert } };
  }
}

module.exports = new participantIdentityService();

