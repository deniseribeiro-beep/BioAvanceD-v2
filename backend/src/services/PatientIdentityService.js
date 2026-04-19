const { getCollection } = require('../utils/collectionResolver');
const { generateUniquePatientID } = require('../utils/patientAnonymization');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeName(value) {
  return normalizeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

function birthDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class PatientIdentityService {
  async matchOrUpsertPatient(db, payload = {}) {
    const patientsCollection = await getCollection(db, 'patients');

    const patientID = normalizeString(payload.patientID || payload.patientId);
    const patientName = normalizeString(payload.patientName || payload.name);
    const normalizedPatientName = normalizeName(patientName);
    const birthDate = parseBirthDate(payload.birthDate);
    const birthKey = birthDateKey(birthDate);

    if (!patientID && (!normalizedPatientName || !birthKey)) {
      throw new Error('Identificação insuficiente: informe patientID ou (patientName + birthDate).');
    }

    const demographicsUpdate = {};
    const updatableFields = [
      'email',
      'sex',
      'phone',
      'cpf',
      'recordNumber',
      'clinicalUnit',
      'unitAcronym',
      'status',
      'isDeceased',
      'representativeName',
      'representativeEmail',
      'representativeCpf',
    ];

    if (patientName) demographicsUpdate.patientName = patientName;
    if (normalizedPatientName) demographicsUpdate.patientNameNormalized = normalizedPatientName;
    if (birthDate) {
      demographicsUpdate.birthDate = birthDate;
      demographicsUpdate.birthDateKey = birthKey;
    }

    updatableFields.forEach((field) => {
      if (payload[field] !== undefined && payload[field] !== null && String(payload[field]).trim() !== '') {
        demographicsUpdate[field] = payload[field];
      }
    });

    const matchFilter = patientID
      ? {
        $or: [
          { patientID },
          ...(normalizedPatientName && birthKey ? [{ patientNameNormalized: normalizedPatientName, birthDateKey: birthKey }] : []),
        ],
      }
      : { patientNameNormalized: normalizedPatientName, birthDateKey: birthKey };

    const existing = await patientsCollection.findOne(matchFilter);

    if (existing) {
      await patientsCollection.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...demographicsUpdate,
            updatedAt: new Date(),
          },
        }
      );

      return {
        created: false,
        matchType: patientID && String(existing.patientID || '') === patientID ? 'patientID' : 'name+birthDate',
        patient: {
          ...existing,
          ...demographicsUpdate,
          patientID: String(existing.patientID || patientID || '').trim(),
        },
      };
    }

    const generatedPatientID = patientID || await generateUniquePatientID(db, patientsCollection.collectionName || 'patients');
    const toInsert = {
      patientID: generatedPatientID,
      patientName: patientName || 'PACIENTE SEM NOME',
      patientNameNormalized: normalizedPatientName || normalizeName(patientName || 'PACIENTE SEM NOME'),
      birthDate: birthDate || null,
      birthDateKey: birthKey || '',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...demographicsUpdate,
    };

    const insertResult = await patientsCollection.insertOne(toInsert);

    return {
      created: true,
      matchType: 'new',
      patient: {
        _id: insertResult.insertedId,
        ...toInsert,
      },
    };
  }
}

module.exports = new PatientIdentityService();
