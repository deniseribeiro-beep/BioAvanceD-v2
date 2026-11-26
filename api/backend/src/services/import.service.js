const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const logger = require('../utils/logger');
const PatientModel = require('../models/Patient');
const SampleModule = require('../models/Sample');
const SampleModel = SampleModule.SampleModel || SampleModule;
const TemperatureModel = require('../models/Temperature');
const influxTelemetryWriteRepository = require('../infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const { readingIdentityOf, screenReading, splitContractFields, auditStrippedFields } = require('./telemetryReadingContract');
const fhirValidator = require('./fhir-validator.service');
const notificationService = require('./notification.service');
const { getCollection } = require('../utils/collectionResolver');
const {
  omitLegacyIdentityFields,
  PARTICIPANT_IDENTITY_ONLY_FIELDS,
  omitParticipantIdentityOnlyFields
} = require('../utils/legacyPatientIdentityFields');
const ParticipantIdentityModel = require('../models/ParticipantIdentity');
const participantIdentityService = require('./participantIdentity.service');
const { parseBirthDateInput } = require('../utils/birthDate');
const SampleGraphValidator = require('./SampleGraphValidator');
const qualityDomain = require('./quality-domain.service');
const qualityCompatibility = require('./quality-compatibility.service');
const rcsAssessmentService = require('./rcs-assessment.service');
const sampleCertification = require('./sample-certification.service');
const sampleCollectionGate = require('./sample-collection-gate.service');
const { insertSampleWithProjection } = require('./graphProjection.service');
const { issueSpecimenLabel } = require('./specimenLabel.service');
const { withoutLegacyBarcode } = require('../utils/sampleBarcodeWindow');
const specimenPreanalyticsService = require('./specimen-preanalytics.service');
const { generateUniqueSpecimenId } = require('../utils/sampleIDGenerator');
const { generateUniqueParticipantId } = require('../utils/patientAnonymization');
const { hashConsentToken } = require('../utils/consentTokenHash');

// RULE-025, RF009 AC8 (#1582): the temperature import's reading contract, the
// columns parseTemperatureCSV reads. Any other column is stripped per row.
const TEMPERATURE_IMPORT_READING_FIELDS = Object.freeze([
  'sensorId', 'sensorID', 'temperatureValue', 'temperatureUnit', 'timestamp', 'readingStatus', 'sensorStatus',
  'signalQuality', 'batteryLevel', 'locationId', 'locationID', 'facility', 'zone',
]);

/**
 * Service de Importação de Dados
 * RF007 - Upload e Importação de Dados
 * Suporta: Pacientes (CSV/JSON), Amostras (CSV/JSON), Arquivos de Analise (ZIP/RAW/CSV), Temperatura (CSV/Streaming)
 */
// #1378: a row that gives a code has it issued as a LabelIdentifier
// (V2E-0169) on the specimen's container, created and loaded here, as
// its first placement would be. This import generates no code, so a row
// without one gets no label. A code already active as a label fails the row.
async function issueImportedSampleLabel(db, sample, insertedId) {
  if (sample.barcode === undefined || sample.barcode === null || !String(sample.barcode).trim()) return;
  await issueSpecimenLabel(db, { ...sample, _id: insertedId }, {
    code: String(sample.barcode).trim(),
    actorId: null,
    at: new Date(),
  });
}

class ImportService {
  normalizeImportKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  getRowValue(row = {}, aliases = []) {
    const aliasSet = new Set((Array.isArray(aliases) ? aliases : []).map((key) => this.normalizeImportKey(key)));
    for (const [rawKey, rawValue] of Object.entries(row || {})) {
      const normalized = this.normalizeImportKey(rawKey);
      if (aliasSet.has(normalized)) {
        return rawValue;
      }
    }
    return undefined;
  }

  async readSpreadsheetRows(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return [];
    }

    let headers = [];
    const rows = [];

    worksheet.eachRow((row, rowNumber) => {
      const values = row.values.slice(1).map((value) => {
        if (value === undefined || value === null) {
          return '';
        }
        if (typeof value === 'object' && value.text !== undefined) {
          return String(value.text);
        }
        if (value instanceof Date) {
          return value.toISOString();
        }
        return String(value);
      });

      if (rowNumber === 1) {
        headers = values;
        return;
      }

      const rowObj = {};
      headers.forEach((header, index) => {
        if (String(header || '').trim()) {
          rowObj[String(header).trim()] = values[index];
        }
      });

      if (Object.values(rowObj).some((item) => String(item || '').trim() !== '')) {
        rows.push(rowObj);
      }
    });

    return rows;
  }

  /**
   * Valida formato do arquivo
   */
  validateFileFormat(file, allowedTypes) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;

    const validExtensions = {
      'patients': ['.csv', '.json', '.xlsx'],
      'samples': ['.csv', '.json', '.xlsx'],
      'results': ['.zip', '.raw', '.csv', '.xlsx'],
      'temperature': ['.csv'],
      'locations': ['.csv', '.json']
    };

    const validMimeTypes = {
      'patients': ['text/csv', 'application/json', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      'samples': ['text/csv', 'application/json', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      'results': ['application/zip', 'application/octet-stream', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      'temperature': ['text/csv'],
      'locations': ['text/csv', 'application/json']
    };

    const extensions = validExtensions[allowedTypes] || [];
    const mimeTypes = validMimeTypes[allowedTypes] || [];

    return extensions.includes(ext) || mimeTypes.includes(mimeType);
  }

  /**
   * Valida estrutura do arquivo CSV
   */
  async validateCSVStructure(file, dataType) {
    return new Promise((resolve, reject) => {
      const requiredFields = this.getRequiredFields(dataType);
      if (requiredFields.length === 0) {
        return reject(new Error(`Tipo de dados desconhecido: ${dataType}`));
      }

      const errors = [];
      const rows = [];
      let headerRow = null;

      const stream = fs.createReadStream(file.path)
        .on('error', reject)
        .pipe(csv())
        .on('headers', (headers) => {
          headerRow = headers;
          const missingFields = requiredFields.filter(field => !headers.includes(field));
          if (missingFields.length > 0) {
            errors.push(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
          }
        })
        .on('data', (row) => {
          rows.push(row);
        })
        .on('end', () => {
          if (errors.length > 0) {
            return reject(new Error(errors.join('; ')));
          }
          resolve({ valid: true, rowCount: rows.length, headers: headerRow });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Retorna campos obrigatórios por tipo de dados
   */
  getRequiredFields(dataType) {
    const fields = {
      'patients': ['patientName', 'birthDate', 'sex'],
      'samples': ['participantId', 'sampleType', 'sampleOrigin'],
      'temperature': ['sensorId', 'temperatureValue', 'timestamp'],
      'results': ['specimenId', 'fileType', 'filePath'],
      'locations': ['equipmentType', 'block', 'rack', 'drawer', 'box']
    };
    return fields[dataType] || [];
  }

  /**
   * Valida arquivo JSON como FHIR R4 (Patient/Specimen/Observation/Organization)
   */
  validateFHIRFile(file, { registry } = {}) {
    try {
      const raw = fs.readFileSync(file.path, 'utf8');
      const payload = JSON.parse(raw);

      if (!fhirValidator.isFhirResource(payload)) {
        return { isFhir: false, valid: true };
      }

      const result = fhirValidator.validatePayload(payload, ['Patient', 'Specimen', 'Observation', 'Organization', 'Bundle'], { registry });
      const operationOutcome = fhirValidator.buildOperationOutcome(result.issues || []);

      return {
        isFhir: true,
        valid: result.valid,
        issues: result.issues || [],
        resourcesValidated: result.resourcesValidated || 0,
        operationOutcome
      };
    } catch (error) {
      return {
        isFhir: false,
        valid: false,
        issues: [{
          severity: 'error',
          code: 'invalid',
          diagnostics: error.message || 'Arquivo JSON inválido',
          expression: '/'
        }],
        resourcesValidated: 0,
        operationOutcome: fhirValidator.buildOperationOutcome([
          { severity: 'error', code: 'invalid', diagnostics: error.message || 'Arquivo JSON inválido', expression: '/' }
        ])
      };
    }
  }

  /**
   * Processa importação de pacientes
   */
  async importPatients(db, file) {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const patientsCollection = await getCollection(db, 'patients');
      const results = { success: 0, errors: [], total: 0 };

      // Função de merge inteligente
      function mergePatientData(existing, incoming) {
        const merged = { ...existing };
        for (const key of Object.keys(incoming)) {
          // Nunca sobrescrever campos existentes com nulo/vazio
          if (
            incoming[key] !== undefined &&
            incoming[key] !== null &&
            !(typeof incoming[key] === 'string' && incoming[key].trim() === '')
          ) {
            // Não permite mudar birthDate
            if (key === 'birthDate' && existing.birthDate && incoming.birthDate && String(existing.birthDate) !== String(incoming.birthDate)) {
              throw new Error('Data de nascimento não pode ser alterada para paciente já existente.');
            }
            // Para arrays (ex: samples), faz append
            if (Array.isArray(existing[key]) && Array.isArray(incoming[key])) {
              merged[key] = [...existing[key], ...incoming[key]];
            } else if (typeof incoming[key] === 'object' && typeof existing[key] === 'object' && incoming[key] && existing[key]) {
              merged[key] = { ...existing[key], ...incoming[key] };
            } else {
              merged[key] = incoming[key];
            }
          }
        }
        return merged;
      }

      // Remove campos legados/clínicos que ParticipantModel não aceita mais
      // como top-level (decisão de #142: fluxo de criação de paciente é
      // disease-agnostic) e migra o identificador legado CPF para o campo
      // canônico identityDocument.
      function stripLegacyPatientFields(patientData) {
        if (patientData.cpf && !patientData.identityDocument) {
          patientData.identityDocument = patientData.cpf;
        }
        delete patientData.cpf;
        delete patientData.weight;
        delete patientData.heightCm;
        delete patientData.diagnosticHypothesis;
        delete patientData.icdCode;
        delete patientData.hypertension;
        delete patientData.obesity;
        delete patientData.diabetesType1;
        delete patientData.diabetesType2;
        delete patientData.copd;
        delete patientData.ckd;
        delete patientData.smoking;
        delete patientData.alcoholUse;
        delete patientData.asthma;
        delete patientData.antibioticUse;
        delete patientData.insulinUse;
        delete patientData.antiviralUse;
        delete patientData.geneticVariant;
        delete patientData.notes;
        return patientData;
      }

      // Encontra o paciente existente (por identityDocument OU recordNumber,
      // já que ParticipantModel.validate() exige participantId e rejeita
      // qualquer campo fora do allowlist canônico) e gera/preserva o
      // participantId ANTES da validação, mesmo padrão adotado em
      // import-lgpd.service.js para #199/#226.
      //
      // RF005/RNF007 (#563): identityDocument is civil identity — resolved
      // via ParticipantIdentity, same as patient.service.js#checkIdentifierConflict
      // (#561). #1386: so is recordNumber now (P1X-0355, recordNumberHash);
      // a number held only on the legacy patients.recordNumber is not matched.
      // RF005/RNF007 (#575): patientName/birthDate were previously enforced
      // as required by PatientModel.validate() (they were in its
      // requiredText list). Now that they're civil identity — segregated to
      // ParticipantIdentity, never a Patient field — validate() no longer
      // checks them, so this import path needs its own explicit check
      // (import-lgpd.service.js's importPatients/importPatientsSmart already
      // do this independently) or a row with no name/birthdate would import
      // silently with an empty ParticipantIdentity.
      function validateIdentityFieldsPresent(patientData) {
        const errors = [];
        if (!patientData.patientName || (typeof patientData.patientName === 'string' && patientData.patientName.trim() === '')) {
          errors.push('patientName é obrigatório');
        }
        // Mirrors PatientModel.validate()'s old birthDate check: a Date
        // instance or a non-empty string are both accepted here (parsing
        // into an actual Date happens later, in ParticipantIdentityModel.create()).
        const isValidBirthDate = patientData.birthDate instanceof Date
          ? !Number.isNaN(patientData.birthDate.getTime())
          : typeof patientData.birthDate === 'string' && patientData.birthDate.trim() !== '';
        if (!isValidBirthDate) {
          errors.push('birthDate é obrigatório');
        }
        return errors;
      }

      async function prepareParticipantId(db, patientData) {
        let existing = null;
        if (patientData.identityDocument) {
          const identityCollection = getCollection(db, 'participantIdentities');
          // RF005/RNF007 (#574): identityDocumentHash lets this dedup match
          // without querying the plaintext field.
          // #1099: match under EVERY registered key, not just the active
          // one -- a hash written before a rotation is otherwise
          // unmatchable, and a missed dedup here creates a DUPLICATE
          // participant rather than raising an error.
          // #1104: identityDocument is ciphertext-only, so a plaintext arm
          // beside the hash would match nothing and make this $or
          // unindexable. The plaintext is queried only on a keyless stack
          // (#1083), the one case that still writes it -- canonicalized,
          // because every writer stores the digits-only form (#1109).
          const identityDocumentHashes = participantIdentityService.computeBlindIndexCandidates('identityDocument', patientData.identityDocument);
          const orConditions = identityDocumentHashes.length
            ? [{ identityDocumentHash: { $in: identityDocumentHashes } }]
            : [{ identityDocument: participantIdentityService.normalizeIdentityDocument(patientData.identityDocument) }];
          const existingIdentity = await identityCollection.findOne({ $or: orConditions });
          if (existingIdentity) {
            existing = await patientsCollection.findOne({ participantId: existingIdentity.participantId });
          }
        } else if (patientData.recordNumber) {
          // #1386: the identity holding this number (P1X-0355). A
          // blank number runs no identity query, and the row still imports
          // as a new participant, as it did before the move.
          const recordNumberQuery = participantIdentityService.recordNumberIdentityQuery(patientData.recordNumber);
          const existingIdentity = recordNumberQuery
            ? await getCollection(db, 'participantIdentities').findOne(recordNumberQuery)
            : null;
          if (existingIdentity) {
            existing = await patientsCollection.findOne({ participantId: existingIdentity.participantId });
          }
        } else {
          return { existing: null, error: 'Sem identificador único (Documento de identidade ou Prontuário)' };
        }

        patientData.participantId = existing ? existing.participantId : await generateUniqueParticipantId(db);
        return { existing };
      }

      async function upsertPatient(db, patientData, existing) {
        if (!existing) {
          // Novo cadastro
          const consentMetadata = notificationService.buildConsentMetadata();
          patientData.status = 'PENDING_CONSENT';
          patientData.consentTokenHash = hashConsentToken(consentMetadata.token);
          patientData.consentTokenCreatedAt = consentMetadata.createdAt;
          patientData.consentTokenExpiresAt = consentMetadata.expiresAt;
          const patient = PatientModel.create(omitLegacyIdentityFields(patientData));
          const insertResult = await patientsCollection.insertOne(patient);

          // RF005/RNF007 (#575): patientName/birthDate/identityDocument are
          // civil identity — they never land on Patient. ParticipantIdentity
          // is the sole write target; patientData (not the stripped
          // `patient`) still carries them here for that write.
          const identityCollection = getCollection(db, 'participantIdentities');
          const identityDoc = participantIdentityService.encryptIdentityFields(
            ParticipantIdentityModel.create({ ...patientData, participantId: patient.participantId })
          );
          // #1166 slice 3: a refused identity insert must not leave the Patient behind.
          await participantIdentityService.insertIdentityOrRollbackPatient(
            identityCollection, identityDoc, patientsCollection, insertResult.insertedId
          );

          if (patient.participantId) {
            try {
              const consentLink = notificationService.buildConsentLink(patient, consentMetadata.token);
              await notificationService.enqueueConsentNotification(patientData, consentLink);
              await patientsCollection.updateOne(
                { _id: insertResult.insertedId },
                { $set: { consentNotifiedAt: new Date() } }
              );
            } catch (notifyError) {
              logger.error('Erro ao enfileirar notificações de consentimento (importação):', notifyError.message);
            }
          }
          return { action: 'new' };
        } else {
          // Merge inteligente
          let merged;
          try {
            merged = mergePatientData(existing, patientData);
          } catch (mergeError) {
            return { action: 'error', error: mergeError.message };
          }
          merged.updatedAt = new Date();
          // RF005/RNF007 (#575): patientName/birthDate/identityDocument
          // never land on Patient — `merged` (used below, un-stripped, for
          // the ParticipantIdentity sync) may still carry them from
          // `existing` (pre-#575 data) even when `patientData` doesn't.
          // #1166 slice 4 / #1168: likewise the contact and the
          // representative, which go to the identity sync below and nowhere else.
          // #1386: and the record number, whose stale Patient copy is removed.
          await patientsCollection.updateOne(
            { _id: existing._id },
            {
              $set: omitParticipantIdentityOnlyFields(omitLegacyIdentityFields(merged)),
              ...(Object.prototype.hasOwnProperty.call(merged, 'recordNumber') ? { $unset: { recordNumber: '' } } : {}),
            }
          );

          // RF005/RNF007 (#561/#563): keep ParticipantIdentity in sync on
          // update, same as patient.service.js#updatePatient — an import
          // merge that touches civil identity fields must not drift the
          // two records apart.
          if (merged.participantId && (
            Object.prototype.hasOwnProperty.call(merged, 'patientName') ||
            Object.prototype.hasOwnProperty.call(merged, 'birthDate') ||
            Object.prototype.hasOwnProperty.call(merged, 'identityDocument') ||
            PARTICIPANT_IDENTITY_ONLY_FIELDS.some((field) => merged[field])
          )) {
            const identityUpdate = { updatedAt: merged.updatedAt };
            for (const field of PARTICIPANT_IDENTITY_ONLY_FIELDS) {
              if (merged[field]) {
                identityUpdate[field] = field === 'email' || field === 'representativeEmail'
                  ? String(merged[field]).trim().toLowerCase()
                  : merged[field];
              }
            }
            if (Object.prototype.hasOwnProperty.call(merged, 'patientName')) identityUpdate.patientName = merged.patientName;
            if (Object.prototype.hasOwnProperty.call(merged, 'birthDate')) identityUpdate.birthDate = merged.birthDate ? parseBirthDateInput(merged.birthDate) : null;
            if (Object.prototype.hasOwnProperty.call(merged, 'identityDocument')) identityUpdate.identityDocument = merged.identityDocument;

            const identityCollection = getCollection(db, 'participantIdentities');
            const identitySet = participantIdentityService.encryptIdentityFields(identityUpdate);
            // #1386: the old <field>Encrypted envelope goes with the rewrite,
            // and an empty $unset (refused before MongoDB 5.0) is not sent.
            const legacyUnset = participantIdentityService.legacyCiphertextUnset(identitySet);
            await identityCollection.updateOne(
              { participantId: merged.participantId },
              {
                $set: identitySet,
                ...(Object.keys(legacyUnset).length > 0 ? { $unset: legacyUnset } : {}),
                // #1386: a merged participant with no identity record gets one here.
                $setOnInsert: ParticipantIdentityModel.onInsertFields(),
              },
              { upsert: true }
            );
          }
          return { action: 'merge' };
        }
      }

      if (ext === '.json') {
        const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        const patients = Array.isArray(data) ? data : [data];

        for (const rawPatientData of patients) {
          results.total++;
          try {
            const patientData = stripLegacyPatientFields({ ...rawPatientData });
            const { existing, error: idError } = await prepareParticipantId(db, patientData);
            if (idError) {
              results.errors.push({ row: results.total, error: idError });
              continue;
            }
            const identityErrors = validateIdentityFieldsPresent(patientData);
            const validation = PatientModel.validate(omitLegacyIdentityFields(patientData));
            const errors = [...identityErrors, ...validation.errors];
            if (errors.length > 0) {
              results.errors.push({
                row: results.total,
                errors
              });
              continue;
            }
            const upsertResult = await upsertPatient(db, patientData, existing);
            if (upsertResult.action === 'error') {
              results.errors.push({
                row: results.total,
                error: upsertResult.error
              });
            } else {
              results.success++;
            }
          } catch (error) {
            results.errors.push({
              row: results.total,
              error: error.message
            });
          }
        }
      } else if (ext === '.csv') {
        const rows = [];
        await new Promise((resolve, reject) => {
          fs.createReadStream(file.path)
            .on('error', reject)
            .pipe(csv())
            .on('data', (row) => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
        });

        for (const row of rows) {
          results.total++;
          try {
            const patientData = stripLegacyPatientFields(this.parsePatientCSV(row));
            const { existing, error: idError } = await prepareParticipantId(db, patientData);
            if (idError) {
              results.errors.push({ row: results.total, error: idError });
              continue;
            }
            const identityErrors = validateIdentityFieldsPresent(patientData);
            const validation = PatientModel.validate(omitLegacyIdentityFields(patientData));
            const errors = [...identityErrors, ...validation.errors];
            if (errors.length > 0) {
              results.errors.push({
                row: results.total,
                errors
              });
              continue;
            }
            const upsertResult = await upsertPatient(db, patientData, existing);
            if (upsertResult.action === 'error') {
              results.errors.push({
                row: results.total,
                error: upsertResult.error
              });
            } else {
              results.success++;
            }
          } catch (error) {
            results.errors.push({
              row: results.total,
              error: error.message
            });
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('Erro ao importar pacientes:', error.message);
      throw error;
    }
  }

  /**
   * Processa importação de amostras
   */
  async importSamples(db, file, options = {}) {
    // #1376: the organization the controller resolved from the caller's scope.
    const organizationId = options.organizationId || null;
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const samplesCollection = await getCollection(db, 'samples');
      const validator = new SampleGraphValidator(db);
      const results = { success: 0, errors: [], total: 0 };

      if (ext === '.json') {
        const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        const samples = Array.isArray(data) ? data : [data];

        for (const sampleDataRaw of samples) {
          try {
            // Normalize legacy quality fields to canonical names (non-destructive)
            const sampleData = qualityCompatibility.normalizeSample(sampleDataRaw || {});
            // RNF018 AC4 (#1537): the row's own RCS result and evidence
            // resolution are never stored; only certification sets them.
            for (const field of [...SampleModule.RCS_DERIVED_FIELDS, 'governanceEvidenceResolution']) delete sampleData[field];
            if (!sampleData.specimenId) {
              sampleData.specimenId = await generateUniqueSpecimenId(db, 'samples');
            }
            const validation = SampleModel.validate(sampleData);
            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              results.total++;
              continue;
            }

            // RNF018 AC4 (#1537): a row with a SPREC is certified as createSample
            // certifies it, its governanceEvidence resolved first (RNF018 AC5).
            // RF004 AC2 (#1538): the row enters only a collection that admits it.
            await sampleCollectionGate.assertSampleCollectionAdmits(db, sampleData);
            await sampleCertification.certifySampleSprec(db, sampleData);
            const sample = SampleModel.create(sampleData);
            // #1376, #1192: the tenancy key comes from the caller's scope,
            // never from the row (SampleModel.create nulls a row's own). A
            // named collection site is kept; a row naming none gets the
            // organization.
            if (organizationId && (sample.collectionSite === undefined
              || sample.collectionSite === null
              || sample.collectionSite === '')) {
              sample.collectionSite = organizationId;
            }
            sample.organizationId = organizationId ? String(organizationId) : null;
            // #1313 (RF023 AC3): the sample and its SPECIMEN_UPSERTED commit together.
            // #1378: after the migration window the inserted sample has no barcode.
            const insertResult = await insertSampleWithProjection(db, samplesCollection, withoutLegacyBarcode(sample), { sourceService: 'import.service' });
            if (sample.rcsEvaluation) {
              try {
                const assessment = await rcsAssessmentService.recordAssessment(db, sample.specimenId, sample.rcsEvaluation);
                // #502: pins integrity verification to this snapshot so a
                // later re-assessment for the same specimenId can't
                // false-positive a tamper report.
                await samplesCollection.updateOne(
                  { _id: insertResult.insertedId },
                  { $set: { sealedRcsAssessmentId: assessment._id } }
                );
              } catch (assessmentError) {
                logger.warn('[IMPORT_SERVICE] Falha ao registrar snapshot RcsAssessment referenciado, amostra mantém cópia embutida', {
                  specimenId: sample.specimenId,
                  error: assessmentError?.message || String(assessmentError),
                });
              }
            }
            if (sample.sprec) {
              try {
                const profile = await specimenPreanalyticsService.recordProfile(db, sample.specimenId, sample.sprec);
                // #502: same pin as above, for the SpecimenPreanalytics half.
                await samplesCollection.updateOne(
                  { _id: insertResult.insertedId },
                  { $set: { sealedSpecimenPreanalyticsId: profile._id } }
                );
              } catch (profileError) {
                logger.warn('[IMPORT_SERVICE] Falha ao registrar snapshot SpecimenPreanalytics referenciado, amostra mantém cópia embutida', {
                  specimenId: sample.specimenId,
                  error: profileError?.message || String(profileError),
                });
              }
            }
            await issueImportedSampleLabel(db, sample, insertResult.insertedId);
            try {
              await validator.validateSampleCompliance(String(insertResult.insertedId));
            } catch (validationError) {
              logger.warn('[IMPORT_SERVICE] Falha ao validar compliance após importação JSON, mantendo em quarentena', {
                specimenId: String(insertResult.insertedId),
                error: validationError?.message || String(validationError),
              });
            }
            results.success++;
          } catch (error) {
            results.errors.push({
              row: results.total + 1,
              error: error.message
            });
          }
          results.total++;
        }
      } else if (ext === '.csv' || ext === '.xlsx') {
        // Valida cabecalhos antes de processar o arquivo inteiro
        if (ext === '.csv') {
          try {
            await this.validateCSVStructure(file, 'samples');
          } catch (structError) {
            results.errors.push({ row: 0, error: structError.message });
            return results;
          }
        }

        const rows = ext === '.xlsx'
          ? await this.readSpreadsheetRows(file.path)
          : await new Promise((resolve, reject) => {
            const dataRows = [];
            fs.createReadStream(file.path)
              .on('error', reject)
              .pipe(csv())
              .on('data', (row) => dataRows.push(row))
              .on('end', () => resolve(dataRows))
              .on('error', reject);
          });

        for (const row of rows) {
          try {
            const { data: sampleDataRaw, parseErrors } = this.parseSampleCSV(row);
            const sampleData = qualityCompatibility.normalizeSample(sampleDataRaw || {});

            if (parseErrors.length > 0) {
              results.errors.push({
                row: results.total + 1,
                errors: parseErrors
              });
              results.total++;
              continue;
            }

            if (!sampleData.specimenId) {
              sampleData.specimenId = await generateUniqueSpecimenId(db, 'samples');
            }

            const validation = SampleModel.validate(sampleData);

            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              results.total++;
              continue;
            }

            // RF004 AC2 (#1538): the row enters only a collection that admits it.
            await sampleCollectionGate.assertSampleCollectionAdmits(db, sampleData);
            const sample = SampleModel.create(sampleData);
            // #1376, #1192: the tenancy key comes from the caller's scope,
            // never from the row (SampleModel.create nulls a row's own). A
            // named collection site is kept; a row naming none gets the
            // organization.
            if (organizationId && (sample.collectionSite === undefined
              || sample.collectionSite === null
              || sample.collectionSite === '')) {
              sample.collectionSite = organizationId;
            }
            sample.organizationId = organizationId ? String(organizationId) : null;
            // #1313 (RF023 AC3): the sample and its SPECIMEN_UPSERTED commit together.
            // #1378: after the migration window the inserted sample has no barcode.
            const insertResult = await insertSampleWithProjection(db, samplesCollection, withoutLegacyBarcode(sample), { sourceService: 'import.service' });
            if (sample.rcsEvaluation) {
              try {
                const assessment = await rcsAssessmentService.recordAssessment(db, sample.specimenId, sample.rcsEvaluation);
                // #502: pins integrity verification to this snapshot so a
                // later re-assessment for the same specimenId can't
                // false-positive a tamper report.
                await samplesCollection.updateOne(
                  { _id: insertResult.insertedId },
                  { $set: { sealedRcsAssessmentId: assessment._id } }
                );
              } catch (assessmentError) {
                logger.warn('[IMPORT_SERVICE] Falha ao registrar snapshot RcsAssessment referenciado, amostra mantém cópia embutida', {
                  specimenId: sample.specimenId,
                  error: assessmentError?.message || String(assessmentError),
                });
              }
            }
            if (sample.sprec) {
              try {
                const profile = await specimenPreanalyticsService.recordProfile(db, sample.specimenId, sample.sprec);
                // #502: same pin as above, for the SpecimenPreanalytics half.
                await samplesCollection.updateOne(
                  { _id: insertResult.insertedId },
                  { $set: { sealedSpecimenPreanalyticsId: profile._id } }
                );
              } catch (profileError) {
                logger.warn('[IMPORT_SERVICE] Falha ao registrar snapshot SpecimenPreanalytics referenciado, amostra mantém cópia embutida', {
                  specimenId: sample.specimenId,
                  error: profileError?.message || String(profileError),
                });
              }
            }
            await issueImportedSampleLabel(db, sample, insertResult.insertedId);
            try {
              await validator.validateSampleCompliance(String(insertResult.insertedId));
            } catch (validationError) {
              logger.warn('[IMPORT_SERVICE] Falha ao validar compliance após importação tabular, mantendo em quarentena', {
                specimenId: String(insertResult.insertedId),
                error: validationError?.message || String(validationError),
              });
            }
            results.success++;
          } catch (error) {
            results.errors.push({
              row: results.total + 1,
              error: error.message
            });
          }
          results.total++;
        }
      }

      return results;
    } catch (error) {
      logger.error('Erro ao importar amostras:', error.message);
      throw error;
    }
  }

  /**
   * Desativado (#466): a coleção legada `locations` deve permanecer
   * somente-leitura durante a transição (regra de coexistência do #457).
   */
  async importLocations() {
    throw new Error(
      "Importação de 'locations' está desativada: a coleção legada locations é somente-leitura durante a transição (#457/#466)."
    );
  }

  /**
   * Processa importação de temperatura
   * RULE-025, RF009 AC8 (#1582): each row's cells outside
   * TEMPERATURE_IMPORT_READING_FIELDS are stripped before hash, screen and
   * store, flag the reading and write one security audit per row, naming the
   * columns and never a value. A blank extra cell carries no value and is not
   * counted; a contract cell reaches parseTemperatureCSV as received.
   */
  async importTemperature(db, file) {
    try {
      const results = { success: 0, errors: [], total: 0 };

      const rows = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(file.path)
          .on('error', reject)
          .pipe(csv())
          .on('data', (row) => rows.push(row))
          .on('end', resolve)
          .on('error', reject);
      });

      for (const row of rows) {
        try {
          // The contract cells reach the parser as received, so a blank one is
          // refused or defaulted exactly as before; only an extra column's
          // blank cell carries no value and goes uncounted.
          const { reading: contractRow, strippedFields: extraColumns } = splitContractFields(row, TEMPERATURE_IMPORT_READING_FIELDS);
          const strippedFields = extraColumns.filter((field) => !(typeof row[field] === 'string' && row[field].trim() === ''));
          await auditStrippedFields(db, { ingestionService: 'temperature-import', strippedFields, sensorId: contractRow.sensorId || contractRow.sensorID || null });
          const tempData = this.parseTemperatureCSV(contractRow);
          const validation = TemperatureModel.validate(tempData);
          
          if (!validation.isValid) {
            results.errors.push({
              row: results.total + 1,
              errors: validation.errors
            });
          } else {
            // RF009 AC1-AC3, AC7 (#1317): an imported reading takes the same reading
            // contract and confirmed InfluxDB write as the other ingestion paths.
            // InfluxDB is the reading's only store (#1391): a row counts as imported
            // once InfluxDB confirms the point, and a failed write is that row's error.
            const identity = readingIdentityOf(tempData, new Date(), { ingestionService: 'temperature-import' });
            // [inference] the import time says nothing about the device's clock, since
            // a file carries readings taken long before it was uploaded, so the clock is
            // `unknown` (V2E-0556, the origin clock's known condition), not `drift`.
            identity.clockStatus = 'unknown';
            await screenReading(db, identity, tempData, { strippedFields });
            const temperature = { ...TemperatureModel.create(tempData), ...identity, timestamp: identity.observedAt };
            try {
              temperature.persistedAt = await influxTelemetryWriteRepository.writeTemperatureReadingNow(temperature);
            } catch (error) {
              throw new Error(`Leitura não persistida no InfluxDB: ${error.message || error}`);
            }
            results.success++;
          }
        } catch (error) {
          results.errors.push({
            row: results.total + 1,
            error: error.message
          });
        }
        results.total++;
      }

      return results;
    } catch (error) {
      logger.error('Erro ao importar temperatura:', error.message);
      throw error;
    }
  }

  /**
   * Parse CSV para Patient
   */
  parsePatientCSV(row) {
    return {
      patientName: row.patientName,
      birthDate: parseBirthDateInput(row.birthDate),
      sex: row.sex,
      email: row.email || null,
      consentTemplateId: row.consentTemplateId || null,
      cpf: row.cpf || null,
      weight: row.weight ? parseFloat(row.weight) : null,
      heightCm: row.heightCm ? parseFloat(row.heightCm) : null,
      recordNumber: row.recordNumber ? parseInt(row.recordNumber) : null,
      clinicalUnit: row.clinicalUnit || null,
      diagnosticHypothesis: row.diagnosticHypothesis || null,
      icdCode: row.icdCode || null,
      hypertension: row.hypertension === 'true' || row.hypertension === '1',
      obesity: row.obesity === 'true' || row.obesity === '1',
      diabetesType1: row.diabetesType1 === 'true' || row.diabetesType1 === '1',
      diabetesType2: row.diabetesType2 === 'true' || row.diabetesType2 === '1',
      copd: row.copd === 'true' || row.copd === '1',
      ckd: row.ckd === 'true' || row.ckd === '1',
      smoking: row.smoking === 'true' || row.smoking === '1',
      alcoholUse: row.alcoholUse === 'true' || row.alcoholUse === '1',
      asthma: row.asthma === 'true' || row.asthma === '1',
      antibioticUse: row.antibioticUse === 'true' || row.antibioticUse === '1',
        insulinUse: row.insulinUse === 'true' || row.insulinUse === '1',
        antiviralUse: row.antiviralUse === 'true' || row.antiviralUse === '1',
        geneticVariant: row.geneticVariant || null,
        notes: row.notes || null
      };
  }

  /**
   * Parse CSV para Sample
   */
  parseSampleCSV(row) {
    const parseErrors = [];

    const normalizeString = (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    };

    const toInt = (value, fieldName) => {
      if (value === undefined || value === null || value === '') return null;
      const parsed = parseInt(String(value).trim(), 10);
      if (Number.isNaN(parsed)) {
        parseErrors.push(`${fieldName} inválido`);
        return null;
      }
      return parsed;
    };

    const toFloat = (value, fieldName) => {
      if (value === undefined || value === null || value === '') return null;
      const parsed = parseFloat(String(value).trim());
      if (Number.isNaN(parsed)) {
        parseErrors.push(`${fieldName} inválido`);
        return null;
      }
      return parsed;
    };

    const toDate = (value, fieldName) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        parseErrors.push(`${fieldName} em formato inválido`);
        return null;
      }
      return parsed;
    };

    const participantIdRaw = this.getRowValue(row, ['participantId', 'patient_id', 'idPaciente']);
    const sampleTypeRaw = this.getRowValue(row, ['sampleType', 'tipoAmostra']);
    const sampleOriginRaw = this.getRowValue(row, ['sampleOrigin', 'origemAmostra']);
    const extractionRaw = this.getRowValue(row, ['extractionProtocol', 'protocoloExtracao']);
    const barcodeRaw = this.getRowValue(row, ['barcode', 'codigoBarras']);
    const qualityRaw = this.getRowValue(row, ['quality', 'qualidade']);
    const qualityScoreRaw = this.getRowValue(row, ['rcsScore', 'qualityScore', 'scoreQualidade']);
    const qualityCategoryRaw = this.getRowValue(row, ['scoreBasedGrade', 'qualityCategory', 'categoriaQualidade']);
    const registrationRaw = this.getRowValue(row, ['registeredAt', 'dataRegistro']);
    const locationRaw = this.getRowValue(row, ['locationID', 'locationId']);
    const linkedProjectRaw = this.getRowValue(row, ['linkedProject', 'projeto']);
    const tcleRaw = this.getRowValue(row, ['consentTemplateId']);
    const merkleRaw = this.getRowValue(row, ['merkleRoot']);
    // RF004 AC2, ELM-0118 (#1538): the row's collection, read by the collection gate.
    const collectionIdRaw = this.getRowValue(row, ['collectionId']);

    const sprec = {
      matrixType: normalizeString(this.getRowValue(row, ['sprec_matrix_type', 'sprecMatrixType'])),
      sampleType: normalizeString(this.getRowValue(row, ['sprec_sample_type', 'sprecSampleType'])),
      primaryContainer: normalizeString(this.getRowValue(row, ['sprec_primary_container', 'sprecPrimaryContainer'])),
      preCentrifugation: normalizeString(this.getRowValue(row, ['sprec_pre_centrifugation', 'sprecPreCentrifugation'])),
      centrifugation: normalizeString(this.getRowValue(row, ['sprec_centrifugation', 'sprecCentrifugation'])),
      secondCentrifugation: normalizeString(this.getRowValue(row, ['sprec_second_centrifugation', 'sprecSecondCentrifugation'])),
      postCentrifugationDelay: normalizeString(this.getRowValue(row, ['sprec_post_centrifugation_delay', 'sprecPostCentrifugationDelay'])),
      longTermStorage: normalizeString(this.getRowValue(row, ['sprec_long_term_storage', 'sprecLongTermStorage'])),
      // dict-02 ELM-0145/0146 (#392) — preserved as given, not recomputed from the axis slots above.
      sprecCode: normalizeString(this.getRowValue(row, ['sprec_code', 'sprecCode'])),
      sprecVersion: normalizeString(this.getRowValue(row, ['sprec_version', 'sprecVersion'])),
    };

    const clinicalData = {
      orphaCode: normalizeString(this.getRowValue(row, ['orphaCode', 'orpha', 'orpha_code'])),
      omimCode: normalizeString(this.getRowValue(row, ['omimCode', 'omim', 'omim_code'])),
      cid: normalizeString(this.getRowValue(row, ['cid', 'cidCode', 'diagnosisCidCode'])),
      phenotypes: [],
      charlsonComorbidities: [],
      biomarkerValues: {},
    };

    const externalQualityAssessment = {
      score: toFloat(qualityScoreRaw, 'rcsScore'),
      category: normalizeString(qualityCategoryRaw),
      source: 'external-import',
      canonical: false,
    };
    const canonicalQualityAssessment = qualityDomain.resolveMethodologicalQuality({ sprec });

    const sampleData = {
      participantId: normalizeString(participantIdRaw),
      sampleType: normalizeString(sampleTypeRaw),
      sampleOrigin: normalizeString(sampleOriginRaw),
      extractionProtocol: normalizeString(extractionRaw),
      barcode: normalizeString(barcodeRaw),
      collectionId: normalizeString(collectionIdRaw),
      registeredAt: toDate(registrationRaw, 'registeredAt') || new Date(),
      quantity: toFloat(this.getRowValue(row, ['quantity', 'volume']), 'quantity'),
      quality: normalizeString(qualityRaw),
      // Canonical RCS-GOV fields (do not rely on legacy `quality_*` for decisioning)
      modelVersion: canonicalQualityAssessment.model_version,
      matrixType: canonicalQualityAssessment.matrix_type,
      governanceStatus: canonicalQualityAssessment.governance_status,
      governanceFailureReasons: canonicalQualityAssessment.governance_failure_reasons || [],
      governanceRuleCodes: canonicalQualityAssessment.governance_rule_codes || [],
      rcsScore: canonicalQualityAssessment.rcs_score,
      scoreBasedGrade: canonicalQualityAssessment.score_based_grade,
      finalGrade: canonicalQualityAssessment.final_grade || '',
      gradeRoute: canonicalQualityAssessment.grade_route,
      axisPenalties: canonicalQualityAssessment.axis_penalties || [],
      calculationTrace: canonicalQualityAssessment.calculation_trace || {},
      rcsEvaluation: canonicalQualityAssessment,
      // Legacy compatibility bucket (non-decisional)
      canonical: {
        rcsScore: externalQualityAssessment.score,
        scoreBasedGrade: externalQualityAssessment.category || '',
        axisPenalties: [],
      },
      externalQualityAssessment,
      // #477 audit: `locationID` (capital ID) here is not a mismatch with
      // Sample.js's Mongoose schema field `locationId` (line 58) — this
      // service inserts via the raw MongoDB driver (bypasses that schema
      // entirely) and `locationID` is the legacy numeric location field
      // consistently read elsewhere (label.routes.js, sample.service.js's
      // cleanup, location-storage-backfill.service.js's #461 backfill
      // query). The Mongoose schema's `locationId` field is the actual
      // outlier — appears unused for writes anywhere in the codebase —
      // but that's a separate, non-blocking housekeeping question, not
      // this write path.
      locationID: toInt(locationRaw, 'locationID'),
      linkedProject: normalizeString(linkedProjectRaw),
      specimenStatus: SampleModel.mapLegacyLifecycleStatusToSpecimenStatus(
        this.getRowValue(row, ['specimenStatus', 'lifecycleStatus', 'statusAtual'])
      ),
      sprec,
      clinicalData,
      consentTemplateId: normalizeString(tcleRaw),
      merkleRoot: normalizeString(merkleRaw),
    };

    return { data: sampleData, parseErrors };
  }

  /**
   * Parse CSV para Temperature
   */
  parseTemperatureCSV(row) {
    return {
      sensorId: row.sensorId || row.sensorID,
      temperatureValue: parseFloat(row.temperatureValue),
      temperatureUnit: row.temperatureUnit || '°C',
      timestamp: row.timestamp ? new Date(row.timestamp) : new Date(),
      readingStatus: row.readingStatus || 'valid',
      sensorStatus: row.sensorStatus || 'normal',
      signalQuality: row.signalQuality || null,
      batteryLevel: row.batteryLevel ? parseInt(row.batteryLevel) : null,
      locationId: row.locationId || row.locationID || null,
      facility: row.facility || null,
      zone: row.zone || null
    };
  }

  /**
   * Limpa arquivo temporário
   */
  cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.error('Erro ao limpar arquivo temporário:', error.message);
    }
  }
}

module.exports = new ImportService();

