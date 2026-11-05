const PatientModel = require('../models/Patient');
const ParticipantIdentityModel = require('../models/ParticipantIdentity');
const {
  parseDayMonthYear,
  parseYearMonthDay,
  parseBirthDateInput,
  parseBirthDateDay,
  birthDateKey,
  birthDateDayRange,
} = require('../utils/birthDate');
const participantIdentityService = require('./participantIdentity.service');
const OrganizationModel = require('../models/Organization');
const logger = require('../utils/logger');
const { generateUniqueParticipantId, sanitizePatientForLogs } = require('../utils/patientAnonymization');
const { encryptValue, decryptValue, assertFieldEncryptionConfigured } = require('../utils/fieldEncryption');
const { fieldMapFor } = require('../utils/encryptedFieldRegistry');
const notificationService = require('./notification.service');
const { getCollection } = require('../utils/collectionResolver');
const {
  omitLegacyIdentityFields,
  PARTICIPANT_REPRESENTATIVE_FIELDS,
  PARTICIPANT_IDENTITY_ONLY_FIELDS,
  omitParticipantIdentityOnlyFields
} = require('../utils/legacyPatientIdentityFields');
const { applyOrganizationScopeFilter } = require('./rbac-assignment.service');
const { hashConsentToken, consentTokenMatches } = require('../utils/consentTokenHash');

const indexedPatientCollections = new Set();

// #1127: the code stamped on the refusals validateConsentToken raises when the
// PARTICIPANT's request is at fault -- unknown id, not awaiting consent, wrong
// token, expired token, missing arguments. Those stay one opaque 400 at the
// controller, per #823's disclosure boundary. Anything else thrown out of that
// method is OUR fault -- a driver error on the findOne, a failed acceptance
// write -- and answering it with 'Link inválido ou expirado' sends the
// participant to ask the biobank team for a new invitation, which cannot help
// them because nothing was wrong with the old link.
//
// The marker is what lets the controller separate the two WITHOUT reopening
// the enumeration oracle: the 400 body stays byte-identical to what #823
// established, and only UNMARKED errors become 503. It is deliberately a stamp
// on the refusals rather than a try/catch around the I/O, so an I/O call site
// added to this flow later answers 503 by default instead of having to
// remember to.
const CONSENT_TOKEN_REJECTION_CODE = 'CONSENT_TOKEN_REJECTED';

function consentTokenRejection(message) {
  const error = new Error(message);
  error.code = CONSENT_TOKEN_REJECTION_CODE;
  return error;
}

// #821: the token was good but the manifestation it carries cannot be
// recorded as sent -- no answers, answers that do not fit the term, or a term
// that was republished after the page loaded. Distinct from a token rejection
// so the participant is told to reload rather than that their link is bad,
// and distinct from an unmarked outage for the same reason #1127 gave.
const CONSENT_MANIFESTATION_REJECTION_CODE = 'CONSENT_MANIFESTATION_REJECTED';

function consentManifestationRejection(message) {
  const error = new Error(message);
  error.code = CONSENT_MANIFESTATION_REJECTION_CODE;
  return error;
}

/**
 * Service de Pacientes
 * RF005 - Cadastro de Paciente com Anonimização LGPD
 */
class PatientService {
  // #1103: the map lives in utils/encryptedFieldRegistry.js, the one
  // inventory of encrypted fields, which the key-rotation rewrite reads too.
  getEncryptedFieldMap() {
    return fieldMapFor('services/patient.service.js');
  }

  encryptSensitivePatientFields(patient = {}) {
    const doc = { ...patient };
    const encryptedFieldMap = this.getEncryptedFieldMap();

    // PatientModel.create() folds alphaGal/lysoGb3 into dadosEspecificos[{tipo:'Fabry'}]
    // instead of keeping them as top-level properties, so they must also be checked
    // (and nulled out) there or they persist in plaintext (#70). Clone the array/entries
    // being mutated so the caller's original patient object is left untouched.
    if (Array.isArray(doc.dadosEspecificos)) {
      doc.dadosEspecificos = doc.dadosEspecificos.map((entry) =>
        entry && entry.dados ? { ...entry, dados: { ...entry.dados } } : entry
      );
    }
    const fabryEntry = Array.isArray(doc.dadosEspecificos)
      ? doc.dadosEspecificos.find((entry) => entry && entry.tipo === 'Fabry' && entry.dados)
      : null;

    for (const [plainField, encryptedField] of Object.entries(encryptedFieldMap)) {
      let plainValue;
      let foundOnTop = false;

      if (Object.prototype.hasOwnProperty.call(doc, plainField)) {
        plainValue = doc[plainField];
        foundOnTop = true;
      } else if (fabryEntry && Object.prototype.hasOwnProperty.call(fabryEntry.dados, plainField)) {
        plainValue = fabryEntry.dados[plainField];
      } else {
        continue;
      }

      // #1083: refuse rather than fall through to encryptValue's null and
      // leave the civil-identity document in plaintext.
      assertFieldEncryptionConfigured(plainValue);
      const encryptedPayload = encryptValue(plainValue);
      if (encryptedPayload) {
        doc[encryptedField] = encryptedPayload;
        if (foundOnTop) {
          doc[plainField] = null;
        }
        if (fabryEntry && Object.prototype.hasOwnProperty.call(fabryEntry.dados, plainField)) {
          fabryEntry.dados[plainField] = null;
        }
      }
    }

    return doc;
  }

  /**
   * #1045: the single response boundary for a participant document. Decrypts
   * the segregated fields as before, then removes the consent CREDENTIAL --
   * see PatientModel.stripConsentSecrets for why the token cannot simply be
   * projected away at the query.
   *
   * Every path that returns a participant to a client goes through this.
   * validateConsentToken, acceptConsentToken and resendConsentNotification
   * deliberately do NOT, because they need the token itself.
   */
  toClientPatient(patient = {}) {
    return PatientModel.stripConsentSecrets(this.decryptSensitivePatientFields(patient));
  }

  decryptSensitivePatientFields(patient = {}) {
    if (!patient || typeof patient !== 'object') return patient;

    const doc = { ...patient };
    const encryptedFieldMap = this.getEncryptedFieldMap();

    for (const [plainField, encryptedField] of Object.entries(encryptedFieldMap)) {
      if (doc[plainField] !== undefined && doc[plainField] !== null && doc[plainField] !== '') {
        continue;
      }

      const payload = doc[encryptedField];
      if (!payload) {
        continue;
      }

      const decryptedValue = decryptValue(payload);
      if (decryptedValue !== null && decryptedValue !== undefined) {
        doc[plainField] = decryptedValue;
      }
    }

    return doc;
  }

  async ensurePatientIndexes(collection, collectionName) {
    if (!collection || !collectionName || indexedPatientCollections.has(collectionName)) return;

    // #1166 slice 4: no phone index any more. `patients` no longer carries the
    // contact, and phone uniqueness is participant_identities_phone_hash_unique_v1
    // (participantIdentityIndexes.js), checked ahead of the write in updatePatient.

    // RF005/RNF007 (#575): patientName/identityDocument no longer live on
    // Patient — drop the indexes built on them from already-deployed
    // collections (no-op via IndexNotFound if never created).
    // #1165: plus the phone index's superseded v1 name, which could not be
    // built on mongo:7 -- dropped anyway so no collection carries both.
    // #1166 slice 4: and v2, whose column is gone. Run the ParticipantIdentity
    // backfill (src/scripts/backfillParticipantIdentities.js) on a database
    // with pre-slice-1 identity rows, so their phones get a phoneHash.
    const legacyIndexNames = [
      'patients_name_document_text_v1',
      'patients_name_idx_v1',
      'patients_phone_unique_sanitized_v1',
      'patients_phone_unique_sanitized_v2',
      // #1386: the record number moved to the identity (P1X-0355), and no reader matches patients.recordNumber.
      'patients_record_number_idx_v1'
    ];
    for (const indexName of legacyIndexNames) {
      try {
        await collection.dropIndex(indexName);
      } catch (error) {
        if (error?.codeName !== 'IndexNotFound') {
          logger.warn(`Não foi possível remover índice legado ${indexName} em ${collectionName}: ${error.message}`);
        }
      }
    }

    indexedPatientCollections.add(collectionName);
  }

  async getIdentityCollection(db) {
    return getCollection(db, 'participantIdentities');
  }

  async getPatientsCollection(db) {
    const patientsCollection = await getCollection(db, 'patients');
    const collectionName = patientsCollection?.collectionName || 'patients';
    await this.ensurePatientIndexes(patientsCollection, collectionName);
    return patientsCollection;
  }

  // #1166 slice 3: the refusal can also come from the identity side's
  // participant_identities_phone_hash_unique_v1, whose keyValue is the blind
  // index -- meaningless to the caller -- so the message carries the phone
  // the caller sent whenever one is known.
  handlePhoneUniqueConstraint(error, submittedPhone) {
    const keyPattern = error?.keyPattern || {};
    const keyValue = error?.keyValue || {};
    const isPhoneDuplicate = Boolean(
      keyPattern.phone || keyPattern.phoneHash
      || Object.prototype.hasOwnProperty.call(keyValue, 'phone')
      || Object.prototype.hasOwnProperty.call(keyValue, 'phoneHash')
    );
    if (!isPhoneDuplicate) return;

    const phone = String(submittedPhone || keyValue.phone || '').trim();
    const duplicateError = new Error(`Telefone ${phone} já cadastrado no sistema.`);
    duplicateError.statusCode = 409;
    throw duplicateError;
  }

  // #1166 slice 4: phone uniqueness is only enforced on the identity side now,
  // and updatePatient writes `patients` before its identity sync. Refusing
  // the duplicate there would leave the Patient row already updated, so the
  // check runs first. The index still catches a race, in the catch below.
  async assertPhoneAvailable(db, patientsCollection, query, phone) {
    const candidates = participantIdentityService.computeBlindIndexCandidates('phone', phone);
    if (candidates.length === 0) return;

    const identityCollection = await this.getIdentityCollection(db);
    const holders = await identityCollection.find({ phoneHash: { $in: candidates } }).toArray();
    if (holders.length === 0) return;

    const target = await patientsCollection.findOne(query);
    if (holders.some((holder) => holder.participantId !== target?.participantId)) {
      const duplicateError = new Error(`Telefone ${phone} já cadastrado no sistema.`);
      duplicateError.statusCode = 409;
      throw duplicateError;
    }
  }

  normalizeClinicalUnit(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toUpperCase();
    return normalized || null;
  }

  async resolveClinicalUnitSnapshot(db, payload = {}) {
    const hasClinicalUnitId = payload.clinicalUnitId !== undefined;
    const hasClinicalUnitName = payload.clinicalUnit !== undefined;

    if (!hasClinicalUnitId && !hasClinicalUnitName) {
      return null;
    }

    const rawClinicalUnitId = payload.clinicalUnitId;
    const rawClinicalUnitName = payload.clinicalUnit;

    const normalizedClinicalUnitId =
      rawClinicalUnitId === null || rawClinicalUnitId === undefined || rawClinicalUnitId === ''
        ? null
        : String(rawClinicalUnitId).trim();

    const normalizedClinicalUnitName =
      rawClinicalUnitName === null || rawClinicalUnitName === undefined || rawClinicalUnitName === ''
        ? null
        : String(rawClinicalUnitName).trim();

    if (!normalizedClinicalUnitId && !normalizedClinicalUnitName) {
      return {
        clinicalUnitId: null,
        clinicalUnit: null,
        unitAcronym: null
      };
    }

    const organizationsCollection = await getCollection(db, 'organizations');

    if (normalizedClinicalUnitId) {
      // P1X-0356: clinicalUnitId now references Organization.organizationId
      // directly (the legacy clinicalUnits ObjectId lookup was retired in
      // #353, once migrateClinicalUnitOrganizations.js resolved existing
      // patient data to Organization references — see #352).
      const organization = await organizationsCollection.findOne({ organizationId: normalizedClinicalUnitId });
      if (organization) {
        const resolvedName = String(organization.officialName || '').trim();
        return {
          clinicalUnitId: String(organization.organizationId),
          clinicalUnit: resolvedName || null,
          unitAcronym: String(organization.acronym || '').trim() || PatientModel.fillAcronym(resolvedName)
        };
      }

      if (!normalizedClinicalUnitName) {
        throw new Error('Unidade clínica não encontrada');
      }
    }

    if (!normalizedClinicalUnitName) {
      return {
        clinicalUnitId: null,
        clinicalUnit: null,
        unitAcronym: null
      };
    }

    const normalizedName = OrganizationModel.normalizeName(normalizedClinicalUnitName);
    const organizationByName = await organizationsCollection.findOne({ normalizedName });

    if (organizationByName) {
      const resolvedName = String(organizationByName.officialName || '').trim();
      return {
        clinicalUnitId: String(organizationByName.organizationId),
        clinicalUnit: resolvedName || null,
        unitAcronym: String(organizationByName.acronym || '').trim() || PatientModel.fillAcronym(resolvedName)
      };
    }

    const fallbackClinicalUnit = this.normalizeClinicalUnit(normalizedClinicalUnitName);
    return {
      clinicalUnitId: null,
      clinicalUnit: fallbackClinicalUnit,
      unitAcronym: fallbackClinicalUnit ? PatientModel.fillAcronym(fallbackClinicalUnit) : null
    };
  }

  normalizerepresentativeIdentityDocument(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).replace(/\D/g, '').trim();
    return normalized || null;
  }

  normalizeRepresentativePhone(value) {
    return this.normalizePhone(value);
  }

  applyDeceasedRepresentativeRules(payload) {
    const isDeceased = payload.isDeceased === true;
    payload.isDeceased = isDeceased;

    if (!isDeceased) {
      payload.representativeName = null;
      payload.representativeEmail = null;
      payload.representativeIdentityDocument = null;
      payload.representativePhone = null;
      return;
    }

    const representativeName = typeof payload.representativeName === 'string' ? payload.representativeName.trim() : '';
    const representativeEmail = this.normalizeEmail(payload.representativeEmail);
    const representativeIdentityDocument = this.normalizerepresentativeIdentityDocument(payload.representativeIdentityDocument);
    const representativePhone = this.normalizeRepresentativePhone(payload.representativePhone);

    if (!representativeName || !representativeEmail || !representativeIdentityDocument || !representativePhone) {
      throw new Error('Para paciente falecido, nome, e-mail, identityDocument e telefone do representante legal são obrigatórios');
    }

    if (!PatientModel.isValidEmail(representativeEmail)) {
      throw new Error('Email do representante legal inválido');
    }

    if (representativeIdentityDocument.length !== 11) {
      throw new Error('identityDocument do representante legal inválido. Informe 11 dígitos');
    }

    if (representativePhone.length < 10 || representativePhone.length > 15) {
      throw new Error('Telefone do representante legal inválido. Informe de 10 a 15 dígitos');
    }

    payload.representativeName = representativeName;
    payload.representativeEmail = representativeEmail;
    payload.representativeIdentityDocument = representativeIdentityDocument;
    payload.representativePhone = representativePhone;
  }

  normalizeEmail(email) {
    if (email === undefined || email === null) return null;
    const normalized = String(email).trim().toLowerCase();
    return normalized || null;
  }

  normalizePhone(phone) {
    if (phone === undefined || phone === null) return null;
    const digits = String(phone).replace(/\D/g, '').trim();
    if (!digits) return null;
    return digits;
  }

  // #1109: single definition, shared with the write side.
  // participantIdentity.service.js normalizes identically before hashing and
  // before storing, so this query-side helper cannot drift from what writers
  // persist.
  normalizeidentityDocument(identityDocument) {
    return participantIdentityService.normalizeIdentityDocument(identityDocument);
  }

  // #1386: delegates, as normalizeidentityDocument does, so the matchers and
  // the identity writer canonicalize the record number alike.
  normalizeRecordNumber(recordNumber) {
    return participantIdentityService.normalizeRecordNumber(recordNumber);
  }

  async checkIdentifierConflict(db, patientData) {
    const normalizedidentityDocument = this.normalizeidentityDocument(patientData?.identityDocument);
    const normalizedRecordNumber = this.normalizeRecordNumber(patientData?.recordNumber);

    // RF005/RNF007 (#561): identityDocument is civil identity — resolved via
    // ParticipantIdentity, not Patient. #1386: so is recordNumber now
    // (P1X-0355, recordNumberHash); a number held only on the legacy
    // patients.recordNumber is not a conflict.
    if (normalizedidentityDocument) {
      const identityCollection = await this.getIdentityCollection(db);
      // RF005/RNF007 (#1104): fifth participantIdentities matching site. Was a
      // plaintext-only lookup with no blind-index arm, so a ciphertext-only row
      // was invisible -- under the cutover the identityDocument uniqueness
      // check would have gone dead, allowing a second participant for the same
      // document. #1099: match under every registered key.
      // #1104: identityDocument is ciphertext-only, so the plaintext arm can
      // never match a row written since, and keeping it would make this $or
      // unindexable (the plaintext column is deliberately unindexed, #1102).
      // The keyless branch still queries the plaintext, which is the only
      // thing a stack with no ENCRYPTION_KEY writes (#1083).
      const identityDocumentHashes = participantIdentityService.computeBlindIndexCandidates('identityDocument', normalizedidentityDocument);
      const documentOrConditions = identityDocumentHashes.length
        ? [{ identityDocumentHash: { $in: identityDocumentHashes } }]
        : [{ identityDocument: normalizedidentityDocument }];
      const existingIdentity = await identityCollection.findOne({ $or: documentOrConditions });
      if (existingIdentity) {
        return { field: 'identityDocument', value: normalizedidentityDocument, existing: existingIdentity };
      }
    }

    if (normalizedRecordNumber) {
      // #1386: the identity holding this number (P1X-0355).
      const recordNumberQuery = participantIdentityService.recordNumberIdentityQuery(normalizedRecordNumber);
      const existingIdentity = recordNumberQuery
        ? await (await this.getIdentityCollection(db)).findOne(recordNumberQuery)
        : null;
      if (existingIdentity) {
        return { field: 'recordNumber', value: normalizedRecordNumber, existing: existingIdentity };
      }
    }

    return null;
  }

  /**
   * Verifica se um paciente já existe (duplicidade)
   * Critério: nome + data de nascimento (normalizada)
   */
  async checkDuplicatePatient(db, patientData) {
    try {
      // RF005/RNF007 (#561): patientName/birthDate are civil identity —
      // resolved via ParticipantIdentity, not the Patient document.
      const identityCollection = await this.getIdentityCollection(db);

      if (!patientData.patientName || !patientData.birthDate) {
        return null; // Não pode verificar sem nome e data
      }

      // Normaliza nome (remove espaços extras, converte para minúsculas)
      const normalizedName = patientData.patientName.trim().toLowerCase().replace(/\s+/g, ' ');

      // Normaliza a data de nascimento para o dia do calendário, 12:00 UTC
      // (#1411 DD/MM/YYYY dia primeiro, #1412 o mesmo dia em todo fuso)
      const normalizedBirthDate = parseBirthDateDay(patientData.birthDate);
      if (!normalizedBirthDate) {
        return null; // Data inválida, não pode verificar
      }

      // Busca todas as identidades e verifica manualmente (mais confiável para comparação de strings)
      // Alternativa: usar índice composto se necessário para performance
      //
      // RF005/RNF007 (#1104): this is the FOURTH participantIdentities
      // matching site and the one #574's "repoint remaining consumers"
      // precondition missed -- it queried the plaintext birthDate with no
      // blind-index arm and compared identity.patientName raw, so a
      // ciphertext-only row was invisible to it. Since this function also
      // fails open (see the catch below: "Em caso de erro, permite
      // continuar"), the ciphertext-only cutover would have silently
      // disabled duplicate detection on createPatient and both LGPD import
      // paths -- the "dois Participants para uma pessoa" failure
      // import-lgpd.service.js:817 warns about in capitals. Same $or shape
      // as the three sibling sites (import.service.js, intakeWizard.js,
      // PatientIdentityService.js).
      // #1099: match under EVERY registered key, so a hash written before an
      // ENCRYPTION_KEY rotation stays matchable.
      const { start: startOfDay, end: endOfDay } = birthDateDayRange(normalizedBirthDate);
      const birthDateHashes = participantIdentityService.computeBlindIndexCandidates('birthDate', normalizedBirthDate);
      // #1104: birthDate is ciphertext-only as of this change, so the plaintext
      // range arm can never match a row written since. Removed rather than kept
      // as a fallback because Mongo serves an $or from indexes only when EVERY
      // arm is indexed, and the plaintext column is deliberately unindexed
      // (#1102) -- keeping it would make this query a collection scan forever.
      // The keyless branch below still queries the plaintext, which is the only
      // thing a stack with no ENCRYPTION_KEY writes (#1083).
      const dateOrConditions = birthDateHashes.length
        ? [{ birthDateHash: { $in: birthDateHashes } }]
        : [{ birthDate: { $gte: startOfDay, $lt: endOfDay } }];
      const allIdentities = await identityCollection.find({ $or: dateOrConditions }).toArray();

      // Verifica se alguma identidade tem o mesmo nome normalizado
      for (const rawIdentity of allIdentities) {
        // #1104: patientName/birthDate are civil identity -- decrypt before
        // comparing so a ciphertext-only row still matches. The RAW document
        // is what gets returned, so this decryption never escapes the
        // comparison and callers see the same shape as before.
        const identity = participantIdentityService.decryptIdentity(rawIdentity);
        if (identity.patientName && identity.birthDate) {
          const existingName = identity.patientName.trim().toLowerCase().replace(/\s+/g, ' ');
          if (existingName === normalizedName &&
              birthDateKey(identity.birthDate) === birthDateKey(normalizedBirthDate)) {
            return rawIdentity;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error('Erro ao verificar duplicidade de paciente:', error.message);
      return null; // Em caso de erro, permite continuar (não bloqueia)
    }
  }

  async createPatient(db, patientData, options = {}) {
    try {
      // PatientModel no longer folds alphaGal/lysoGb3 into dadosEspecificos itself
      // (dropped in e2549bee's canonicalization rewrite), so a caller submitting them
      // top-level would otherwise fail PatientModel.validate()'s canonical-field check.
      // Fold them here before validation, matching the Fabry dadosEspecificos shape
      // encryptSensitivePatientFields() already knows how to encrypt (#70).
      if (patientData.alphaGal !== undefined || patientData.lysoGb3 !== undefined) {
        const dadosEspecificos = Array.isArray(patientData.dadosEspecificos)
          ? [...patientData.dadosEspecificos]
          : [];
        const fabryIndex = dadosEspecificos.findIndex((entry) => entry && entry.tipo === 'Fabry');
        const fabryDados = fabryIndex >= 0 ? { ...dadosEspecificos[fabryIndex].dados } : {};
        if (patientData.alphaGal !== undefined) fabryDados.alphaGal = patientData.alphaGal;
        if (patientData.lysoGb3 !== undefined) fabryDados.lysoGb3 = patientData.lysoGb3;
        const fabryEntry = { tipo: 'Fabry', dados: fabryDados };
        if (fabryIndex >= 0) {
          dadosEspecificos[fabryIndex] = fabryEntry;
        } else {
          dadosEspecificos.push(fabryEntry);
        }
        patientData.dadosEspecificos = dadosEspecificos;
        delete patientData.alphaGal;
        delete patientData.lysoGb3;
      }

      patientData.email = this.normalizeEmail(patientData.email);
      patientData.phone = this.normalizePhone(patientData.phone);

      const clinicalUnitSnapshot = await this.resolveClinicalUnitSnapshot(db, patientData);
      if (clinicalUnitSnapshot) {
        patientData.clinicalUnitId = clinicalUnitSnapshot.clinicalUnitId;
        patientData.clinicalUnit = clinicalUnitSnapshot.clinicalUnit;
        patientData.unitAcronym = clinicalUnitSnapshot.unitAcronym;
      } else {
        patientData.clinicalUnit = this.normalizeClinicalUnit(patientData.clinicalUnit);
        patientData.unitAcronym = patientData.clinicalUnit
          ? PatientModel.fillAcronym(patientData.clinicalUnit)
          : null;
      }

      this.applyDeceasedRepresentativeRules(patientData);
      // #1083, kept by #1168: the representative's document used to be
      // encrypted on the Patient row, where a keyless stack REFUSES the write.
      // It moved to ParticipantIdentity, whose encryption degrades to
      // plaintext by design, so the refusal is asserted here instead.
      assertFieldEncryptionConfigured(patientData.representativeIdentityDocument);

      if (!patientData.consentTemplateId || typeof patientData.consentTemplateId !== 'string') {
        throw new Error('Template de consentimento (consentTemplateId) é obrigatório');
      } else {
        const consentTemplateId = patientData.consentTemplateId.trim();
        const { ObjectId } = require('mongodb');
        if (!ObjectId.isValid(consentTemplateId)) {
          throw new Error('consentTemplateId inválido');
        }

        const consentTemplatesCollection = await getCollection(db, 'consentTemplates');
        const templateExists = await consentTemplatesCollection.findOne({ _id: new ObjectId(consentTemplateId) });
        if (!templateExists) {
          throw new Error('Template de consentimento não encontrado');
        }

        patientData.consentTemplateId = consentTemplateId;
      }

      // RF021 AC#4 (#594): studyId is optional — not every patient is
      // enrolled in a research study — but when provided, it must resolve
      // to a real Study, same referential-integrity pattern as
      // sample.service.js:187-192 (Sample.studyId) and consent.service.js's
      // createPatientConsent (#593, PatientConsent.studyId).
      if (patientData.studyId !== undefined && patientData.studyId !== null && patientData.studyId !== '') {
        const study = await db.collection('studies').findOne({ studyId: String(patientData.studyId) });
        if (!study) {
          throw new Error(`studyId ${patientData.studyId} não encontrado`);
        }
        // RF021 AC#5 (#596): same status gate #591 added for Sample.studyId
        // — a patient can't be linked to a study that isn't active.
        if (study.studyStatus !== 'active') {
          const error = new Error(`Estudo ${patientData.studyId} não está ativo (status: ${study.studyStatus})`);
          error.statusCode = 422;
          throw error;
        }
      }

      // RF005/RNF007 (#575): patientName/birthDate were previously enforced
      // as required by PatientModel.validate() (they were in its
      // requiredText list). Now that they're civil identity — segregated to
      // ParticipantIdentity, never a Patient field — validate() no longer
      // checks them, so creation needs its own explicit check here.
      if (!patientData.patientName || (typeof patientData.patientName === 'string' && patientData.patientName.trim() === '')) {
        throw new Error('patientName é obrigatório');
      }
      if (!patientData.birthDate) {
        throw new Error('birthDate é obrigatório');
      }

      const validation = PatientModel.validate(omitLegacyIdentityFields(patientData));
      if (!validation.isValid) {
        // RNF018 (#1300): a validation failure answers 422; the caller's catch
        // keeps every other error on its own status.
        const validationError = new Error(validation.errors.join(', '));
        validationError.statusCode = 422;

        validationError.details = validation.errors;
        throw validationError;
      }

      patientData.identityDocument = this.normalizeidentityDocument(patientData.identityDocument);
      patientData.recordNumber = this.normalizeRecordNumber(patientData.recordNumber);

      const identifierConflict = await this.checkIdentifierConflict(db, patientData);
      if (identifierConflict) {
        const conflictError = new Error(
          identifierConflict.field === 'identityDocument'
            ? `identityDocument ${identifierConflict.value} já cadastrado no sistema.`
            : identifierConflict.field === 'recordNumber'
              ? `Prontuário ${identifierConflict.value} já cadastrado no sistema.`
              : 'Paciente com identificadores já cadastrado no sistema.'
        );
        conflictError.statusCode = 409;
        throw conflictError;
      }

      // Verifica duplicidade antes de criar
      const duplicate = await this.checkDuplicatePatient(db, patientData);
      if (duplicate) {
        throw new Error(`Paciente duplicado: já existe um paciente com o nome "${patientData.patientName}" e data de nascimento "${patientData.birthDate}" cadastrado no sistema.`);
      }

      // Gera sigla da unidade por iniciais e garante uppercase
      if (patientData.clinicalUnit) {
        patientData.unitAcronym = PatientModel.fillAcronym(patientData.clinicalUnit);
      }
      if (patientData.unitAcronym) {
        patientData.unitAcronym = String(patientData.unitAcronym).toUpperCase();
      }

      // GERA ID ÚNICO DE 8 DÍGITOS AUTOMATICAMENTE (LGPD)
      // Remove participantId se fornecido - será gerado automaticamente
      delete patientData.participantId;
      
      // Remove campo height se existir (não deve ser salvo no banco)
      delete patientData.height;
      
      // Gera ID único criptograficamente seguro
      const participantId = await generateUniqueParticipantId(db);
      patientData.participantId = participantId;

      const consentMetadata = notificationService.buildConsentMetadata();
      patientData.status = 'PENDING_CONSENT';
      patientData.consentTokenHash = hashConsentToken(consentMetadata.token);
      patientData.consentTokenCreatedAt = consentMetadata.createdAt;
      patientData.consentTokenExpiresAt = consentMetadata.expiresAt;

      const patientsCollection = await this.getPatientsCollection(db);
      const patient = PatientModel.create(omitLegacyIdentityFields(patientData));
      const persistedPatient = this.encryptSensitivePatientFields(patient);

      const result = await patientsCollection.insertOne(persistedPatient);

      // RF005/RNF007 (#575): patientName/birthDate/identityDocument are civil
      // identity — they never land on Patient. ParticipantIdentity is the
      // sole write target; patientData (not the stripped `patient`) still
      // carries them here for that write.
      const identityCollection = await getCollection(db, 'participantIdentities');
      const identityDoc = participantIdentityService.encryptIdentityFields(
        ParticipantIdentityModel.create({ ...patientData, participantId })
      );
      await participantIdentityService.insertIdentityOrRollbackPatient(
        identityCollection, identityDoc, patientsCollection, result.insertedId
      );

      if (options.skipConsentNotification !== true) {
        try {
          const consentLink = notificationService.buildConsentLink(patient, consentMetadata.token);
          await notificationService.enqueueConsentNotification(patientData, consentLink);
          await patientsCollection.updateOne(
            { _id: result.insertedId },
            { $set: { consentNotifiedAt: new Date() } }
          );
        } catch (notifyError) {
          logger.error('Erro ao enfileirar notificações de consentimento:', notifyError.message);
        }
      }

      // Log sanitizado (sem dados sensíveis)
      const sanitizedData = sanitizePatientForLogs(patient);
      logger.info('Paciente criado:', sanitizedData);

      // Retorna paciente com ID gerado
      return {
        _id: result.insertedId,
        ...patient,
        participantId: participantId // ID gerado automaticamente
      };
    } catch (error) {
      if (error?.code === 11000) {
        this.handlePhoneUniqueConstraint(error, patientData?.phone);
      }
      logger.error('Erro ao criar paciente:', error.message);
      throw error;
    }
  }

  async getPatient(db, participantId) {
    try {
      const patientsCollection = await this.getPatientsCollection(db);
      // Busca por participantId (string de 8 dígitos), _id (ObjectId de 24
      // caracteres hex) ou participantId de formato livre (#603 -- ex.:
      // participantes importados via FHIR, cujo participantId é derivado do
      // FHIR Patient.id e não segue nenhum dos dois formatos acima).
      let patient;
      if (typeof participantId === 'string' && /^\d{8}$/.test(participantId)) {
        patient = await patientsCollection.findOne({ participantId });
      } else if (typeof participantId === 'string' && /^[0-9a-fA-F]{24}$/.test(participantId)) {
        const { ObjectId } = require('mongodb');
        patient = await patientsCollection.findOne({ _id: new ObjectId(participantId) });
      } else {
        patient = await patientsCollection.findOne({ participantId });
      }
      return this.toClientPatient(patient);
    } catch (error) {
      logger.error('Erro ao buscar paciente:', error.message);
      throw error;
    }
  }

  async listPatients(db, filters = {}) {
    try {
      const patientsCollection = await this.getPatientsCollection(db);
      const query = {};

      // RF005/RNF007 (#561): patientName is civil identity — resolved via
      // ParticipantIdentity, not read/filtered directly off Patient.
      if (filters.patientName) {
        const identityCollection = await this.getIdentityCollection(db);
        // #1104: patientName is ciphertext-only, so this is an EXACT match on
        // the normalized full name (accents, case and spacing ignored) through
        // patientNameHash. It used to be a case-insensitive substring $regex,
        // which a blind index cannot serve; no screen sent this filter.
        // #1099: match under every registered key. The keyless branch queries
        // the plaintext, the only thing a stack with no ENCRYPTION_KEY writes
        // (#1083), with the same exact-match semantics: anchored and escaped,
        // so the caller's term is never read as a pattern.
        const patientNameHashes = participantIdentityService.computeBlindIndexCandidates('patientName', filters.patientName);
        const escapedName = String(filters.patientName).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameCondition = patientNameHashes.length
          ? { patientNameHash: { $in: patientNameHashes } }
          : { patientName: { $regex: `^${escapedName}$`, $options: 'i' } };
        const matchingIdentities = await identityCollection
          .find(nameCondition)
          .toArray();
        query.participantId = { $in: matchingIdentities.map((identity) => identity.participantId) };
      }

      if (filters.clinicalUnit) {
        query.clinicalUnit = filters.clinicalUnit;
      }

      // #340 (RF003 AC#3): org-scoped caller sees only patients whose
      // clinicalUnitId is one of their scoped organizations. No-op for a
      // 'global' (Administrador) scope. Caller must resolve+attach
      // organizationScope via rbac.js's requireOrganizationScope first.
      if (filters.organizationScope) {
        applyOrganizationScopeFilter(query, filters.organizationScope, 'clinicalUnitId');
      }

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      const patients = await patientsCollection
        .find(query)
        .limit(limit)
        .skip(skip)
        .toArray();

      const total = await patientsCollection.countDocuments(query);
      const listed = patients.map((patient) => this.toClientPatient(patient));

      return { patients: await this.attachDirectoryIdentity(db, listed), total, limit, skip };
    } catch (error) {
      logger.error('Erro ao listar pacientes:', error.message);
      throw error;
    }
  }

  // Cadastro directory: record number and birth date only. An empty page
  // does not touch the identity collection. Name, document and contact stay out.
  async attachDirectoryIdentity(db, patients) {
    if (!Array.isArray(patients) || patients.length === 0) return patients || [];
    const fields = await participantIdentityService.directoryFieldsByParticipantId(
      db,
      patients.map((patient) => patient.participantId)
    );
    return patients.map((patient) => {
      const extra = fields.get(String(patient.participantId)) || { recordNumber: null, birthDate: null };
      return { ...patient, recordNumber: extra.recordNumber, birthDate: extra.birthDate };
    });
  }

  /**
   * Busca pacientes por múltiplos critérios (exceto nome e histórico clínico)
   * Permite busca por: participantId, recordNumber, birthDate, clinicalUnit, unitAcronym, icdCode, etc.
   * recordNumber é correspondência exata, via ParticipantIdentity (#1386).
   */
  async searchPatients(db, searchTerm, organizationScope = null) {
    try {
      const patientsCollection = await this.getPatientsCollection(db);
      
      if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
        return { patients: [], total: 0 };
      }

      const term = searchTerm.trim();
      const query = { $or: [] };

      // Busca por participantId (8 dígitos)
      if (/^\d{8}$/.test(term)) {
        query.$or.push({ participantId: term });
      }

      // Busca por data de nascimento (formato DD/MM/YYYY ou YYYY-MM-DD)
      // RF005/RNF007 (#561): birthDate is civil identity — resolved via
      // ParticipantIdentity, not matched directly on the Patient document.
      if (term.includes('/') || term.includes('-')) {
        // DD/MM/YYYY dia primeiro (#1411); YYYY-MM-DD o mesmo dia, não a
        // meia-noite UTC de new Date() (#1412)
        const searchDate = term.includes('/') ? parseDayMonthYear(term) : parseYearMonthDay(term);

        if (searchDate) {
          // Busca por data exata (ignora hora)
          const { start: startDate, end: endDate } = birthDateDayRange(searchDate);
          const identityCollection = await this.getIdentityCollection(db);
          // RF005/RNF007 (#1104): sixth participantIdentities matching site,
          // same shape as checkIdentifierConflict's -- a plaintext range query
          // with no blind-index arm. #1099: match under every registered key.
          const birthDateHashes = participantIdentityService.computeBlindIndexCandidates('birthDate', searchDate);
          // #1104: birthDate is ciphertext-only as of this change, so the plaintext
          // range arm can never match a row written since. Removed rather than kept
          // as a fallback because Mongo serves an $or from indexes only when EVERY
          // arm is indexed, and the plaintext column is deliberately unindexed
          // (#1102) -- keeping it would make this query a collection scan forever.
          // The keyless branch below still queries the plaintext, which is the only
          // thing a stack with no ENCRYPTION_KEY writes (#1083).
          const dateOrConditions = birthDateHashes.length
            ? [{ birthDateHash: { $in: birthDateHashes } }]
            : [{ birthDate: { $gte: startDate, $lt: endDate } }];
          const matchingIdentities = await identityCollection
            .find({ $or: dateOrConditions })
            .toArray();
          if (matchingIdentities.length > 0) {
            query.$or.push({ participantId: { $in: matchingIdentities.map((identity) => identity.participantId) } });
          }
        }
      }

      // #1386: a number moved to ParticipantIdentity (P1X-0355) is matched on
      // recordNumberHash, so this arm is an EXACT match on the normalized
      // number -- a blind index cannot serve a substring search, the #1104
      // precedent for patientName.
      const recordNumberQuery = participantIdentityService.recordNumberIdentityQuery(term);
      const recordNumberIdentities = recordNumberQuery
        ? await (await this.getIdentityCollection(db)).find(recordNumberQuery).toArray()
        : [];
      if (recordNumberIdentities.length > 0) {
        query.$or.push({ participantId: { $in: recordNumberIdentities.map((identity) => identity.participantId) } });
      }

      // Busca por unidade clínica
      query.$or.push({ clinicalUnit: { $regex: term, $options: 'i' } });

      // Busca por sigla da unidade
      query.$or.push({ unitAcronym: { $regex: term, $options: 'i' } });

      // Busca por código CID
      query.$or.push({ icdCode: { $regex: term, $options: 'i' } });

      // Busca por hipótese diagnóstica
      query.$or.push({ diagnosticHypothesis: { $regex: term, $options: 'i' } });

      // Busca por variante genética
      query.$or.push({ geneticVariant: { $regex: term, $options: 'i' } });

      // Busca por observações/notes
      query.$or.push({ notes: { $regex: term, $options: 'i' } });

      // Se não há critérios, retorna vazio
      if (query.$or.length === 0) {
        return { patients: [], total: 0 };
      }

      // #626 (RF003 AC#3): org-scoped caller only searches within their
      // scoped clinicalUnitId(s) — a separate code path from listPatients,
      // so filtered here rather than reusing that method's own query.
      if (organizationScope) {
        applyOrganizationScopeFilter(query, organizationScope, 'clinicalUnitId');
      }

      const patients = await patientsCollection.find(query).limit(50).toArray();
      const total = await patientsCollection.countDocuments(query);

      return { patients: patients.map((patient) => this.toClientPatient(patient)), total };
    } catch (error) {
      logger.error('Erro ao buscar pacientes:', error.message);
      throw error;
    }
  }

  async updatePatient(db, participantId, updateData, options = {}) {
    let submittedPhone = null;
    try {
      // #1277: every declared field the patch carries must hold its type,
      // checked on the raw input before anything below coerces it. Before
      // this, only the fields named below were checked, and a wrong type in
      // any other (sex, status, studyId, anamneseGeral, a consent date) went
      // straight into the $set.
      const typeErrors = PatientModel.validateUpdateTypes(updateData);
      if (typeErrors.length > 0) {
        const error = new Error(typeErrors.join(', '));
        error.statusCode = 422;
        error.code = 'INVALID_FIELD_TYPE';
        error.fields = typeErrors;
        throw error;
      }
      // A date given as a string is stored as a Date, as create() stores it.
      // birthDate is converted where it is routed to ParticipantIdentity.
      for (const field of ['consentTokenCreatedAt', 'consentTokenExpiresAt', 'consentNotifiedAt', 'consentAcceptedAt', 'createdAt']) {
        if (typeof updateData[field] === 'string') updateData[field] = new Date(updateData[field]);
      }

      const patientsCollection = await this.getPatientsCollection(db);

      if (updateData.unitAcronym !== undefined) {
        updateData.unitAcronym = updateData.unitAcronym
          ? String(updateData.unitAcronym).trim().toUpperCase()
          : null;
      }

      if (updateData.email !== undefined) {
        updateData.email = this.normalizeEmail(updateData.email);
        if (!updateData.email || !PatientModel.isValidEmail(updateData.email)) {
          throw new Error('Email (email) inválido');
        }
      }

      // #1083, kept by #1168: see createPatient -- refused on the raw input,
      // exactly where the Patient-side encryption loop used to refuse it.
      if (updateData.representativeIdentityDocument !== undefined) {
        assertFieldEncryptionConfigured(updateData.representativeIdentityDocument);
      }

      if (updateData.phone !== undefined) {
        const normalizedPhone = this.normalizePhone(updateData.phone);
        if (updateData.phone !== null && updateData.phone !== '' && (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 15)) {
          throw new Error('Telefone (phone) inválido. Informe de 10 a 15 dígitos');
        }
        updateData.phone = normalizedPhone;
        submittedPhone = normalizedPhone;
      }

      // #1168: the stored representative lives on ParticipantIdentity only, so
      // the merge reads it from there, decrypted. isDeceased stays a Patient
      // field. This runs BEFORE the encryption loop below: that loop used to
      // null the plaintext representativeIdentityDocument first, so the rules
      // saw it as missing and refused every such edit on a keyed stack.
      if (updateData.isDeceased !== undefined ||
        PARTICIPANT_REPRESENTATIVE_FIELDS.some((field) => updateData[field] !== undefined)) {
        const existingPatient = await this.getPatient(db, participantId);
        const storedIdentity = existingPatient?.participantId
          ? participantIdentityService.decryptIdentity(
            await (await this.getIdentityCollection(db)).findOne({ participantId: existingPatient.participantId })
          ) || {}
          : {};
        const mergedPayload = { isDeceased: existingPatient?.isDeceased };
        for (const field of PARTICIPANT_REPRESENTATIVE_FIELDS) mergedPayload[field] = storedIdentity[field];
        Object.assign(mergedPayload, updateData);
        this.applyDeceasedRepresentativeRules(mergedPayload);
        updateData.isDeceased = mergedPayload.isDeceased;
        for (const field of PARTICIPANT_REPRESENTATIVE_FIELDS) updateData[field] = mergedPayload[field];
      }

      // #1166/#1168: the contact and the representative are mirrored too, and
      // stripped BEFORE the patients-side encryption loop below, which would
      // otherwise null representativeIdentityDocument's plaintext first -- ParticipantIdentity is their only home.
      const identityOnlyFieldsFromUpdate = {};
      for (const field of PARTICIPANT_IDENTITY_ONLY_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(updateData, field)) {
          identityOnlyFieldsFromUpdate[field] = updateData[field];
        }
      }
      updateData = omitParticipantIdentityOnlyFields(updateData);

      const encryptedFieldMap = this.getEncryptedFieldMap();
      for (const [plainField, encryptedField] of Object.entries(encryptedFieldMap)) {
        if (Object.prototype.hasOwnProperty.call(updateData, plainField)) {
          // #1083: same gate on the update path -- without it the write
          // returned success with the plaintext still in $set.
          assertFieldEncryptionConfigured(updateData[plainField]);
          const encryptedPayload = encryptValue(updateData[plainField]);
          if (encryptedPayload) {
            updateData[encryptedField] = encryptedPayload;
            updateData[plainField] = null;
          }
        }
      }

      if (updateData.clinicalUnit !== undefined || updateData.clinicalUnitId !== undefined) {
        const clinicalUnitSnapshot = await this.resolveClinicalUnitSnapshot(db, updateData);
        if (clinicalUnitSnapshot) {
          updateData.clinicalUnitId = clinicalUnitSnapshot.clinicalUnitId;
          updateData.clinicalUnit = clinicalUnitSnapshot.clinicalUnit;
          updateData.unitAcronym = clinicalUnitSnapshot.unitAcronym;
        }
      }

      
      // Validação antes de atualizar
      if (updateData.participantId) {
        // Não permite alterar o participantId (é imutável por LGPD)
        delete updateData.participantId;
      }
      
      // Remove campo height se existir (não deve ser salvo no banco)
      if (updateData.height !== undefined) {
        // Se height foi fornecido e heightCm não, converte
        if (updateData.height !== null && !updateData.heightCm) {
          const heightValue = parseFloat(updateData.height);
          if (!isNaN(heightValue) && heightValue > 0) {
            // Se o valor for menor que 3, assume que está em metros
            updateData.heightCm = heightValue < 3 ? heightValue * 100 : heightValue;
          }
        }
        delete updateData.height; // Remove após converter ou se for null/undefined
      }
      
      // Atualiza updatedAt
      updateData.updatedAt = new Date();

      // RF005/RNF007 (#575): patientName/birthDate/identityDocument are
      // civil identity — capture them for the ParticipantIdentity sync
      // below, then strip before the $set below so Patient never carries
      // them.
      const identityFieldsFromUpdate = {};
      for (const field of ['patientName', 'birthDate', 'identityDocument']) {
        if (Object.prototype.hasOwnProperty.call(updateData, field)) {
          identityFieldsFromUpdate[field] = updateData[field];
        }
      }
      updateData = omitLegacyIdentityFields(updateData);

      // Busca por participantId (string de 8 dígitos), _id (ObjectId de 24
      // caracteres hex) ou participantId de formato livre (#604 -- mesmo
      // padrão do #603 em getPatient(): participantes importados via FHIR,
      // cujo participantId não segue nenhum dos dois formatos acima).
      let query;
      if (typeof participantId === 'string' && participantId.length === 8 && /^\d{8}$/.test(participantId)) {
        // É um participantId de 8 dígitos
        query = { participantId };
      } else if (typeof participantId === 'string' && /^[0-9a-fA-F]{24}$/.test(participantId)) {
        // É um ObjectId
        const { ObjectId } = require('mongodb');
        query = { _id: new ObjectId(participantId) };
      } else {
        query = { participantId };
      }

      if (identityOnlyFieldsFromUpdate.phone) {
        await this.assertPhoneAvailable(db, patientsCollection, query, identityOnlyFieldsFromUpdate.phone);
      }

      // #1386: the record number now lives on ParticipantIdentity alone, so
      // an update that carries it also removes the stale Patient copy.
      const result = await patientsCollection.updateOne(
        query,
        {
          $set: updateData,
          ...(Object.prototype.hasOwnProperty.call(identityOnlyFieldsFromUpdate, 'recordNumber')
            ? { $unset: { recordNumber: '' } }
            : {}),
        }
      );

      if (result.matchedCount === 0) {
        throw new Error('Paciente não encontrado');
      }

      // Log sanitizado
      const sanitizedData = sanitizePatientForLogs({ participantId: typeof participantId === 'string' && participantId.length === 8 ? participantId : 'N/A' });
      logger.info('Paciente atualizado:', sanitizedData);

      const updatedPatient = await patientsCollection.findOne(query);
      const decryptedUpdatedPatient = this.toClientPatient(updatedPatient);

      // RF005/RNF007 (#561): keep ParticipantIdentity in sync on update —
      // #363's dual-write only covered createPatient, so an edit to any of
      // these fields via updatePatient previously drifted the two records
      // apart silently.
      if (updatedPatient?.participantId && (
        Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'patientName') ||
        Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'birthDate') ||
        Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'identityDocument') ||
        Object.keys(identityOnlyFieldsFromUpdate).length > 0
      )) {
        const identityUpdate = { ...identityOnlyFieldsFromUpdate, updatedAt: updateData.updatedAt };
        if (Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'patientName')) {
          identityUpdate.patientName = identityFieldsFromUpdate.patientName;
        }
        if (Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'birthDate')) {
          identityUpdate.birthDate = identityFieldsFromUpdate.birthDate ? parseBirthDateInput(identityFieldsFromUpdate.birthDate) : null;
        }
        if (Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'identityDocument')) {
          identityUpdate.identityDocument = identityFieldsFromUpdate.identityDocument;
        }
        // #1386: canonicalized here, so a whitespace-only number is a clear
        // below and its old ciphertext and hash go with it.
        if (Object.prototype.hasOwnProperty.call(identityUpdate, 'recordNumber')) {
          identityUpdate.recordNumber = participantIdentityService.normalizeRecordNumber(identityUpdate.recordNumber);
        }

        // RF005/RNF007 (#1104, #1109): this sync is a participantIdentities
        // writer like any other, so it goes through encryptIdentityFields --
        // otherwise an edit writes raw plaintext onto a ciphertext-only field,
        // stores an uncanonicalized identityDocument, and leaves the blind
        // index on the OLD value for every matching site to find. A field
        // cleared here must clear its ciphertext and hash as well, or
        // decryptIdentity recovers the old value from the ciphertext.
        const encryptedFieldMap = participantIdentityService.getEncryptedFieldMap();
        const hashFieldMap = participantIdentityService.getHashFieldMap();
        const clearedSiblings = {};
        for (const [plainField, encryptedField] of Object.entries(encryptedFieldMap)) {
          if (Object.prototype.hasOwnProperty.call(identityUpdate, plainField)
            && (identityUpdate[plainField] === null || identityUpdate[plainField] === '')) {
            clearedSiblings[encryptedField] = null;
            if (hashFieldMap[plainField]) clearedSiblings[hashFieldMap[plainField]] = null;
          }
        }
        const encryptedIdentityUpdate = {
          ...participantIdentityService.encryptIdentityFields(identityUpdate),
          ...clearedSiblings,
        };

        // #1386: the old <field>Encrypted envelope goes with the rewrite. It
        // is built from the $set after clearedSiblings, so a cleared field's
        // old envelope goes too; an empty $unset (refused before MongoDB 5.0)
        // is not sent.
        const legacyUnset = participantIdentityService.legacyCiphertextUnset(encryptedIdentityUpdate);
        const identityCollection = await this.getIdentityCollection(db);
        await identityCollection.updateOne(
          { participantId: updatedPatient.participantId },
          {
            $set: encryptedIdentityUpdate,
            ...(Object.keys(legacyUnset).length > 0 ? { $unset: legacyUnset } : {}),
            // #1386: a patient with no identity record gets one here.
            $setOnInsert: ParticipantIdentityModel.onInsertFields(),
          },
          { upsert: true }
        );
      }

      return { success: true };
    } catch (error) {
      if (error?.code === 11000) {
        this.handlePhoneUniqueConstraint(error, submittedPhone);
      }
      logger.error('Erro ao atualizar paciente:', error.message);
      throw error;
    }
  }

  /**
   * #1127: true only for the refusals this service raises against the caller's
   * own request. The controller answers those 400 and everything else 503.
   */
  isConsentTokenRejection(error) {
    return error?.code === CONSENT_TOKEN_REJECTION_CODE;
  }

  /** #821: true for a manifestation refused as sent; the controller answers 422. */
  isConsentManifestationRejection(error) {
    return error?.code === CONSENT_MANIFESTATION_REJECTION_CODE;
  }

  async validateConsentToken(db, participantId, token) {
    if (!participantId || !token) {
      throw consentTokenRejection('participantId e token são obrigatórios');
    }

    // #1127: NOT wrapped. A driver error here is not a bad token, and it
    // reaches the controller unmarked so it is answered as the outage it is.
    const patientsCollection = await this.getPatientsCollection(db);
    const query = { participantId };
    const patient = await patientsCollection.findOne(query);

    if (!patient) {
      throw consentTokenRejection('Paciente não encontrado');
    }

    // #1049: only the hash is stored, compared in constant time. A legacy
    // row still holding a plaintext `consentToken` and no hash is rejected
    // here; src/scripts/migrateConsentTokenHash.js converts those in place.
    if (!consentTokenMatches(patient.consentTokenHash, token)) {
      throw consentTokenRejection('Token inválido');
    }

    if (patient.consentTokenExpiresAt && new Date(patient.consentTokenExpiresAt) < new Date()) {
      throw consentTokenRejection('Token expirado');
    }

    return { valid: true, participantId: patient.participantId, patientStatus: patient.status || null };
  }

  /**
   * #821: RF010 AC#2-5,7 -- a bulk-invited participant's acceptance is a
   * manifestation, so it is recorded as a Consent by the canonical recorder
   * (consentId, exact term version, evidence, outbox event), with the
   * participant's per-permission answers, against the term the page showed.
   * It used to flip Patient.status and record nothing.
   *
   * The record is written BEFORE the status flip, so a failed write leaves
   * the token live and the participant can retry.
   */
  async acceptConsentToken(db, participantId, token, manifestation = {}) {
    await this.validateConsentToken(db, participantId, token);
    const pendingPatient = await (await this.getPatientsCollection(db)).findOne({ participantId });
    if (!pendingPatient || pendingPatient.status !== 'PENDING_CONSENT') {
      throw consentTokenRejection('Paciente não está pendente de consentimento');
    }

    // Lazy: consent.service's module graph is not needed by any other path
    // here, and the recorder is the only thing taken from it.
    const consentService = require('./consent.service');

    const { consentTemplateId, responses, ipAddress, userAgent } = manifestation || {};
    if (!consentTemplateId || !responses || typeof responses !== 'object' || Array.isArray(responses)) {
      throw consentManifestationRejection('consentTemplateId e responses são obrigatórios');
    }

    // The page renders getActiveTemplateForParticipant (consent.controller
    // validate), so an
    // answer set is only meaningful against that same term. A republish in
    // between would otherwise record answers to a text never shown.
    const activeTemplate = await consentService.getActiveTemplateForParticipant(db, participantId);
    if (!activeTemplate || String(activeTemplate._id) !== String(consentTemplateId)) {
      throw consentManifestationRejection('O termo de consentimento foi atualizado');
    }

    try {
      consentService.validateResponsesAgainstTemplate(activeTemplate, responses);
    } catch (validationError) {
      throw consentManifestationRejection(validationError.message);
    }

    const consent = await consentService.createPatientConsent(db, {
      participantId,
      consentTemplateId: String(consentTemplateId),
      responses,
      ipAddress,
      userAgent
    }, {
      // RF010 AC4: the participant's own acceptance through the token link.
      channel: 'electronic_link',
      signerRole: 'participant',
      authenticationLevel: 'token'
    });

    const patientsCollection = await this.getPatientsCollection(db);
    const consentPanel = require('./consentPanel.service');
    await patientsCollection.updateOne(
      { participantId },
      {
        $set: {
          status: 'ACTIVE',
          consentAcceptedAt: new Date(),
          consentTokenExpiresAt: consentPanel.consentPanelExpiresAt(activeTemplate),
          updatedAt: new Date()
        }
      }
    );
    await consentPanel.recordPanelLinkCommunication(db, consent, 'delivered');

    return {
      success: true,
      participantId,
      consentId: consent.consentId,
      consentVersion: consent.consentVersion
    };
  }

  /**
   * The participant, holding the same panel token, revokes the whole consent
   * or the permissions they name. The consent written is the one belonging
   * to that participantId; unchecking a permission does not open a new consent.
   */
  async revokeConsentByToken(db, participantId, token, request = {}) {
    await this.validateConsentToken(db, participantId, token);
    const consentService = require('./consent.service');
    const consent = await consentService.getPatientConsent(db, participantId);
    const inForce = consent
      && consent.status === 'ACTIVE'
      && consent.currentStateDerived !== 'revoked'
      && consent.currentStateDerived !== 'superseded';
    if (!inForce) {
      throw consentManifestationRejection('Não há consentimento em vigor para revogar');
    }
    if (consent.participantId && String(consent.participantId) !== String(participantId)) {
      throw consentManifestationRejection('O consentimento não pertence a este participante');
    }

    const scope = Array.isArray(request.scope) ? request.scope.filter((key) => typeof key === 'string' && key.trim()) : undefined;
    const updated = await consentService.revokeConsent(db, String(consent._id), {
      scope: scope && scope.length > 0 ? scope : undefined,
      reason: typeof request.reason === 'string' ? request.reason : undefined,
      location: request.location,
    }, {
      channel: 'electronic_link',
      signerRole: 'participant',
      signerId: participantId,
      authenticationLevel: 'token',
    });
    if (updated && updated.status === 'REVOKED') {
      try {
        const consentQuarantineService = require('./consentQuarantine.service');
        await consentQuarantineService.quarantineForRevocation(db, participantId);
      } catch (quarantineError) {
        logger.error('Erro ao quarentenar amostras na revogação do participante:', quarantineError.message);
      }
    }
    return {
      participantId,
      status: updated?.status || consent.status,
      currentStateDerived: updated?.currentStateDerived || consent.currentStateDerived || null,
      effectivePermissions: updated?.effectivePermissions || consent.effectivePermissions || {},
    };
  }

  async resendConsentNotification(db, participantId) {
    if (!participantId) {
      throw new Error('participantId é obrigatório');
    }

    const patientsCollection = await this.getPatientsCollection(db);
    const patient = await patientsCollection.findOne({ participantId });

    if (!patient) {
      throw new Error('Paciente não encontrado');
    }

    // A signed consent is the gate. patient.status alone misses a directory
    // row whose badge is still pending because no consent is in force.
    const consentsCollection = await getCollection(db, 'consents');
    const activeConsent = await consentsCollection.findOne({ participantId, status: 'ACTIVE' });
    if (activeConsent) {
      throw new Error('Paciente não está pendente de consentimento');
    }

    // #1049: a resend always mints a fresh token. It used to re-send the
    // stored token while it was unexpired, which needed the plaintext at rest;
    // only its hash is stored now, so it cannot be recovered. The link a
    // participant already holds stops working once this one is persisted.
    const consentMetadata = notificationService.buildConsentMetadata();
    const token = consentMetadata.token;

    // RF005/RNF007 (#561/#564): patientName resolved via ParticipantIdentity
    // instead of read directly off the Patient document.
    const identityCollection = await this.getIdentityCollection(db);
    const rawIdentity = await identityCollection.findOne({ participantId });
    // #1104: patientName is civil identity -- decrypt before reading it, or a
    // ciphertext-only row sends the consent invitation with no name. This read
    // had no decryptIdentity anywhere in its path.
    const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;
    // #1166 slice 2: and the contact the invitation goes to, from the same
    // decrypted record rather than the Patient's own copy.
    const patientWithIdentity = identity
      ? { ...participantIdentityService.withIdentityContact(patient, identity), patientName: identity.patientName }
      : patient;

    const consentLink = notificationService.buildConsentLink(patientWithIdentity, token);

    // Persisted BEFORE delivery, the #810 ordering the publication sweep
    // uses: an emailed link is only usable if the database already holds its
    // hash, so a failure here means "not sent" rather than "sent, unusable".
    // A legacy plaintext `consentToken` is removed in the same write.
    await patientsCollection.updateOne(
      { _id: patient._id },
      {
        $set: {
          consentTokenHash: hashConsentToken(token),
          consentTokenCreatedAt: consentMetadata.createdAt,
          consentTokenExpiresAt: consentMetadata.expiresAt,
          updatedAt: new Date()
        },
        $unset: { consentToken: '' }
      }
    );

    await notificationService.enqueueConsentNotification(patientWithIdentity, consentLink);

    await patientsCollection.updateOne(
      { _id: patient._id },
      { $set: { consentNotifiedAt: new Date(), updatedAt: new Date() } }
    );

    return {
      success: true,
      participantId,
      consentTokenExpiresAt: consentMetadata.expiresAt
    };
  }

  async deletePatient(db, participantId) {
    try {
      const patientsCollection = await this.getPatientsCollection(db);
      
      // Busca por participantId (string de 8 dígitos), _id (ObjectId de 24
      // caracteres hex) ou participantId de formato livre (#604 -- mesmo
      // padrão do #603 em getPatient(): participantes importados via FHIR,
      // cujo participantId não segue nenhum dos dois formatos acima).
      let query;
      if (typeof participantId === 'string' && participantId.length === 8 && /^\d{8}$/.test(participantId)) {
        // É um participantId de 8 dígitos
        query = { participantId };
      } else if (typeof participantId === 'string' && /^[0-9a-fA-F]{24}$/.test(participantId)) {
        // É um ObjectId
        const { ObjectId } = require('mongodb');
        query = { _id: new ObjectId(participantId) };
      } else {
        query = { participantId };
      }

      const result = await patientsCollection.deleteOne(query);
      
      // Log sanitizado
      const sanitizedData = sanitizePatientForLogs({ participantId: typeof participantId === 'string' && participantId.length === 8 ? participantId : 'N/A' });
      logger.info('Paciente deletado:', sanitizedData);
      
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Erro ao deletar paciente:', error.message);
      throw error;
    }
  }
}

module.exports = new PatientService();



