const PatientModel = require('../models/Patient');
const ParticipantIdentityModel = require('../models/ParticipantIdentity');
const participantIdentityService = require('./participantIdentity.service');
const OrganizationModel = require('../models/Organization');
const logger = require('../utils/logger');
const { generateUniqueParticipantId, sanitizePatientForLogs } = require('../utils/patientAnonymization');
const { encryptValue, decryptValue, assertFieldEncryptionConfigured } = require('../utils/fieldEncryption');
const notificationService = require('./notification.service');
const { getCollection } = require('../utils/collectionResolver');
const { omitLegacyIdentityFields } = require('../utils/legacyPatientIdentityFields');
const { applyOrganizationScopeFilter } = require('./rbac-assignment.service');

const indexedPatientCollections = new Set();

/**
 * Service de Pacientes
 * RF005 - Cadastro de Paciente com Anonimização LGPD
 */
class PatientService {
  getEncryptedFieldMap() {
    return {
      representativeIdentityDocument: 'representativeIdentityDocumentEncrypted'
    };
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
    if (!collection) return;
    if (!collectionName) return;
    if (indexedPatientCollections.has(collectionName)) return;

    const indexDefinitions = [
      [
        { phone: 1 },
        {
          name: 'patients_phone_unique_sanitized_v1',
          unique: true,
          partialFilterExpression: {
            phone: { $type: 'string', $ne: '' }
          }
        }
      ],
      [{ recordNumber: 1 }, { name: 'patients_record_number_idx_v1' }]
    ];

    for (const [keys, options] of indexDefinitions) {
      try {
        await collection.createIndex(keys, options);
      } catch (error) {
        logger.warn(`Não foi possível criar índice ${options.name} em ${collectionName}: ${error.message}`);
      }
    }

    // RF005/RNF007 (#575): patientName/identityDocument no longer live on
    // Patient — drop the indexes built on them from already-deployed
    // collections (no-op via IndexNotFound if never created).
    const legacyIndexNames = ['patients_name_document_text_v1', 'patients_name_idx_v1'];
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
    const collectionName = patientsCollection && patientsCollection.collectionName
      ? patientsCollection.collectionName
      : 'patients';
    await this.ensurePatientIndexes(patientsCollection, collectionName);
    return patientsCollection;
  }

  handlePhoneUniqueConstraint(error) {
    const keyPattern = error && error.keyPattern ? error.keyPattern : {};
    const keyValue = error && error.keyValue ? error.keyValue : {};
    let isPhoneDuplicate = Boolean(keyPattern.phone);
    if (!isPhoneDuplicate) {
      isPhoneDuplicate = Object.prototype.hasOwnProperty.call(keyValue, 'phone');
    }
    if (!isPhoneDuplicate) return;

    const duplicateError = new Error(`Telefone ${String(keyValue.phone || '').trim()} já cadastrado no sistema.`);
    duplicateError.statusCode = 409;
    throw duplicateError;
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
      } else {
        void 0;
      }
    } else {
      void 0;
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
    } else {
      void 0;
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
    } else {
      void 0;
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

  normalizeRecordNumber(recordNumber) {
    if (recordNumber === undefined || recordNumber === null) return null;
    const normalized = String(recordNumber).trim();
    return normalized || null;
  }

  async checkIdentifierConflict(db, patientData) {
    const normalizedidentityDocument = this.normalizeidentityDocument(patientData?.identityDocument);
    const normalizedRecordNumber = this.normalizeRecordNumber(patientData?.recordNumber);

    // RF005/RNF007 (#561): identityDocument is civil identity — resolved via
    // ParticipantIdentity, not Patient. recordNumber is a hospital record
    // number, not civil identity, so it stays checked against Patient.
    if (normalizedidentityDocument) {
      const identityCollection = await this.getIdentityCollection(db);
      // RF005/RNF007 (#1104): fifth participantIdentities matching site. Was a
      // plaintext-only lookup with no blind-index arm, so a ciphertext-only row
      // was invisible -- under the cutover the identityDocument uniqueness
      // check would have gone dead, allowing a second participant for the same
      // document. #1099: match under every registered key.
      const identityDocumentHashes = participantIdentityService.computeBlindIndexCandidates('identityDocument', normalizedidentityDocument);
      const documentOrConditions = identityDocumentHashes.length
        ? [{ identityDocumentHash: { $in: identityDocumentHashes } }, { identityDocument: normalizedidentityDocument }]
        : [{ identityDocument: normalizedidentityDocument }];
      const existingIdentity = await identityCollection.findOne({ $or: documentOrConditions });
      if (existingIdentity) {
        return { field: 'identityDocument', value: normalizedidentityDocument, existing: existingIdentity };
      }
    }

    if (normalizedRecordNumber) {
      const patientsCollection = await this.getPatientsCollection(db);
      const existingPatient = await patientsCollection.findOne({ recordNumber: normalizedRecordNumber });
      if (existingPatient) {
        return { field: 'recordNumber', value: normalizedRecordNumber, existing: existingPatient };
      } else {
        void 0;
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

      // Normaliza data de nascimento (converte para Date se necessário)
      let birthDate;
      if (patientData.birthDate instanceof Date) {
        birthDate = patientData.birthDate;
      } else if (typeof patientData.birthDate === 'string') {
        // Tenta parsear formato DD/MM/YYYY
        const parts = patientData.birthDate.split('/');
        if (parts.length === 3) {
          birthDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        } else {
          birthDate = new Date(patientData.birthDate);
        }
      } else {
        birthDate = patientData.birthDate;
      }

      // Garante que birthDate é um objeto Date válido
      if (!(birthDate instanceof Date) || isNaN(birthDate.getTime())) {
        return null; // Data inválida, não pode verificar
      }

      // Normaliza a data para comparar apenas dia/mês/ano (ignora hora)
      const normalizedBirthDate = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());

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
      const startOfDay = new Date(normalizedBirthDate.getFullYear(), normalizedBirthDate.getMonth(), normalizedBirthDate.getDate());
      const endOfDay = new Date(normalizedBirthDate.getFullYear(), normalizedBirthDate.getMonth(), normalizedBirthDate.getDate() + 1);
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
          const existingDate = identity.birthDate instanceof Date
            ? new Date(identity.birthDate.getFullYear(), identity.birthDate.getMonth(), identity.birthDate.getDate())
            : new Date(identity.birthDate);

          if (existingName === normalizedName &&
              existingDate.getTime() === normalizedBirthDate.getTime()) {
            return rawIdentity;
          }
        } else {
          void 0;
        }
      }

      return null;
    } catch (error) {
      logger.error('Erro ao verificar duplicidade de paciente:', error.message);
      return null; // Em caso de erro, permite continuar (não bloqueia)
    }
  }

  async createPatient(db, patientData, options) {
    options = Object(options);
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
        if (patientData.alphaGal !== undefined) {
          fabryDados.alphaGal = patientData.alphaGal;
        } else {
          void 0;
        }
        if (patientData.lysoGb3 !== undefined) {
          fabryDados.lysoGb3 = patientData.lysoGb3;
        } else {
          void 0;
        }
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
        } else {
          void 0;
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
        } else {
          void 0;
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
      } else {
        void 0;
      }

      const validation = PatientModel.validate(omitLegacyIdentityFields(patientData));
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      } else {
        void 0;
      }

      patientData.identityDocument = this.normalizeidentityDocument(patientData.identityDocument);
      patientData.recordNumber = this.normalizeRecordNumber(patientData.recordNumber);

      const identifierConflict = await this.checkIdentifierConflict(db, patientData);
      if (identifierConflict) {
        const conflictMessage = identifierConflict.field === 'identityDocument'
          ? `identityDocument ${identifierConflict.value} já cadastrado no sistema.`
          : `Prontuário ${identifierConflict.value} já cadastrado no sistema.`;
        const conflictError = new Error(conflictMessage);
        conflictError.statusCode = 409;
        throw conflictError;
      } else {
        void 0;
      }

      // Verifica duplicidade antes de criar
      const duplicate = await this.checkDuplicatePatient(db, patientData);
      if (duplicate) {
        throw new Error(`Paciente duplicado: já existe um paciente com o nome "${patientData.patientName}" e data de nascimento "${patientData.birthDate}" cadastrado no sistema.`);
      } else {
        void 0;
      }

      // Gera sigla da unidade por iniciais e garante uppercase
      if (patientData.clinicalUnit) {
        patientData.unitAcronym = PatientModel.fillAcronym(patientData.clinicalUnit);
      } else {
        void 0;
      }
      if (patientData.unitAcronym) {
        patientData.unitAcronym = String(patientData.unitAcronym).toUpperCase();
      } else {
        void 0;
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
      patientData.consentToken = consentMetadata.token;
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
      await identityCollection.insertOne(identityDoc);

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
        this.handlePhoneUniqueConstraint(error);
      } else {
        void 0;
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

  async listPatients(db, filters) {
    filters = Object(filters);
    try {
      const patientsCollection = await this.getPatientsCollection(db);
      const query = {};

      // RF005/RNF007 (#561): patientName is civil identity — resolved via
      // ParticipantIdentity, not read/filtered directly off Patient.
      if (filters.patientName) {
        const identityCollection = await this.getIdentityCollection(db);
        const matchingIdentities = await identityCollection
          .find({ patientName: { $regex: filters.patientName, $options: 'i' } })
          .toArray();
        query.participantId = { $in: matchingIdentities.map((identity) => identity.participantId) };
      } else {
        void 0;
      }

      if (filters.clinicalUnit) {
        query.clinicalUnit = filters.clinicalUnit;
      } else {
        void 0;
      }

      // #340 (RF003 AC#3): org-scoped caller sees only patients whose
      // clinicalUnitId is one of their scoped organizations. No-op for a
      // 'global' (Administrador) scope. Caller must resolve+attach
      // organizationScope via rbac.js's requireOrganizationScope first.
      if (filters.organizationScope) {
        applyOrganizationScopeFilter(query, filters.organizationScope, 'clinicalUnitId');
      } else {
        void 0;
      }

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      const patients = await patientsCollection
        .find(query)
        .limit(limit)
        .skip(skip)
        .toArray();

      const total = await patientsCollection.countDocuments(query);

      return { patients: patients.map((patient) => this.toClientPatient(patient)), total, limit, skip };
    } catch (error) {
      logger.error('Erro ao listar pacientes:', error.message);
      throw error;
    }
  }

  /**
   * Busca pacientes por múltiplos critérios (exceto nome e histórico clínico)
   * Permite busca por: participantId, recordNumber, birthDate, clinicalUnit, unitAcronym, icdCode, etc.
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
      } else {
        void 0;
      }

      // Busca por recordNumber (número ou string)
      query.$or.push({ recordNumber: { $regex: term, $options: 'i' } });
      
      // Tenta como número também
      const numTerm = parseInt(term, 10);
      if (!isNaN(numTerm)) {
        query.$or.push({ recordNumber: numTerm });
      } else {
        void 0;
      }

      // Busca por data de nascimento (formato DD/MM/YYYY ou YYYY-MM-DD)
      // RF005/RNF007 (#561): birthDate is civil identity — resolved via
      // ParticipantIdentity, not matched directly on the Patient document.
      if (term.includes('/') || term.includes('-')) {
        let searchDate;
        let startDate;
        let endDate;
        if (term.includes('/')) {
          // Formato DD/MM/YYYY
          const parts = term.split('/');
          if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
              searchDate = new Date(year, month, day);
              // Busca por data exata (ignora hora)
              startDate = new Date(year, month, day);
              endDate = new Date(year, month, day + 1);
            } else {
              void 0;
            }
          } else {
            void 0;
          }
        } else if (term.includes('-')) {
          // Formato YYYY-MM-DD
          searchDate = new Date(term);
          if (!isNaN(searchDate.getTime())) {
            const year = searchDate.getFullYear();
            const month = searchDate.getMonth();
            const day = searchDate.getDate();
            startDate = new Date(year, month, day);
            endDate = new Date(year, month, day + 1);
          } else {
            void 0;
          }
        } else {
          void 0;
        }

        if (startDate && endDate) {
          const identityCollection = await this.getIdentityCollection(db);
          // RF005/RNF007 (#1104): sixth participantIdentities matching site,
          // same shape as checkIdentifierConflict's -- a plaintext range query
          // with no blind-index arm. #1099: match under every registered key.
          const birthDateHashes = participantIdentityService.computeBlindIndexCandidates('birthDate', startDate);
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
          } else {
            void 0;
          }
        } else {
          void 0;
        }
      } else {
        void 0;
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
      } else {
        void 0;
      }

      const patients = await patientsCollection.find(query).limit(50).toArray();
      const total = await patientsCollection.countDocuments(query);

      return { patients: patients.map((patient) => this.toClientPatient(patient)), total };
    } catch (error) {
      logger.error('Erro ao buscar pacientes:', error.message);
      throw error;
    }
  }

  async updatePatient(db, participantId, updateData, options) {
    try {
      const patientsCollection = await this.getPatientsCollection(db);

      if (updateData.unitAcronym !== undefined) {
        updateData.unitAcronym = updateData.unitAcronym
          ? String(updateData.unitAcronym).trim().toUpperCase()
          : null;
      } else {
        void 0;
      }

      if (updateData.email !== undefined) {
        updateData.email = this.normalizeEmail(updateData.email);
        if (!updateData.email || !PatientModel.isValidEmail(updateData.email)) {
          throw new Error('Email (email) inválido');
        } else {
          void 0;
        }
      } else {
        void 0;
      }

      if (updateData.phone !== undefined) {
        const normalizedPhone = this.normalizePhone(updateData.phone);
        if (updateData.phone !== null && updateData.phone !== '' && (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 15)) {
          throw new Error('Telefone (phone) inválido. Informe de 10 a 15 dígitos');
        }
        updateData.phone = normalizedPhone;
      } else {
        void 0;
      }

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
          } else {
            void 0;
          }
        } else {
          void 0;
        }
      }

      if (updateData.clinicalUnit !== undefined || updateData.clinicalUnitId !== undefined) {
        const clinicalUnitSnapshot = await this.resolveClinicalUnitSnapshot(db, updateData);
        if (clinicalUnitSnapshot) {
          updateData.clinicalUnitId = clinicalUnitSnapshot.clinicalUnitId;
          updateData.clinicalUnit = clinicalUnitSnapshot.clinicalUnit;
          updateData.unitAcronym = clinicalUnitSnapshot.unitAcronym;
        } else {
          void 0;
        }
      } else {
        void 0;
      }

      if (updateData.isDeceased !== undefined ||
        updateData.representativeName !== undefined ||
        updateData.representativeEmail !== undefined ||
        updateData.representativeIdentityDocument !== undefined ||
        updateData.representativePhone !== undefined) {
        const existingPatient = await this.getPatient(db, participantId);
        const mergedPayload = {
          isDeceased: existingPatient?.isDeceased,
          representativeName: existingPatient?.representativeName,
          representativeEmail: existingPatient?.representativeEmail,
          representativeIdentityDocument: existingPatient?.representativeIdentityDocument,
          representativePhone: existingPatient?.representativePhone,
          ...updateData
        };
        this.applyDeceasedRepresentativeRules(mergedPayload);
        updateData.isDeceased = mergedPayload.isDeceased;
        updateData.representativeName = mergedPayload.representativeName;
        updateData.representativeEmail = mergedPayload.representativeEmail;
        updateData.representativeIdentityDocument = mergedPayload.representativeIdentityDocument;
        updateData.representativePhone = mergedPayload.representativePhone;
      } else {
        void 0;
      }
      
      // Validação antes de atualizar
      if (updateData.participantId) {
        // Não permite alterar o participantId (é imutável por LGPD)
        delete updateData.participantId;
      } else {
        void 0;
      }
      
      // Remove campo height se existir (não deve ser salvo no banco)
      if (updateData.height !== undefined) {
        // Se height foi fornecido e heightCm não, converte
        if (updateData.height !== null && !updateData.heightCm) {
          const heightValue = parseFloat(updateData.height);
          if (!isNaN(heightValue) && heightValue > 0) {
            // Se o valor for menor que 3, assume que está em metros
            updateData.heightCm = heightValue < 3 ? heightValue * 100 : heightValue;
          } else {
            void 0;
          }
        } else {
          void 0;
        }
        delete updateData.height; // Remove após converter ou se for null/undefined
      } else {
        void 0;
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

      const result = await patientsCollection.updateOne(
        query,
        { $set: updateData }
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
        Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'identityDocument')
      )) {
        const identityUpdate = { updatedAt: updateData.updatedAt };
        if (Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'patientName')) {
          identityUpdate.patientName = identityFieldsFromUpdate.patientName;
        }
        if (Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'birthDate')) {
          identityUpdate.birthDate = identityFieldsFromUpdate.birthDate ? new Date(identityFieldsFromUpdate.birthDate) : null;
        }
        if (Object.prototype.hasOwnProperty.call(identityFieldsFromUpdate, 'identityDocument')) {
          identityUpdate.identityDocument = identityFieldsFromUpdate.identityDocument;
        }

        const identityCollection = await this.getIdentityCollection(db);
        await identityCollection.updateOne(
          { participantId: updatedPatient.participantId },
          { $set: identityUpdate },
          { upsert: true }
        );
      }

      return { success: true };
    } catch (error) {
      if (error?.code === 11000) {
        this.handlePhoneUniqueConstraint(error);
      }
      logger.error('Erro ao atualizar paciente:', error.message);
      throw error;
    }
  }

  async validateConsentToken(db, participantId, token) {
    if (!participantId || !token) {
      throw new Error('participantId e token são obrigatórios');
    }

    const patientsCollection = await this.getPatientsCollection(db);
    const query = { participantId };
    const patient = await patientsCollection.findOne(query);

    if (!patient) {
      throw new Error('Paciente não encontrado');
    }

    if (patient.status !== 'PENDING_CONSENT') {
      throw new Error('Paciente não está pendente de consentimento');
    }

    if (!patient.consentToken || patient.consentToken !== token) {
      throw new Error('Token inválido');
    }

    if (patient.consentTokenExpiresAt && new Date(patient.consentTokenExpiresAt) < new Date()) {
      throw new Error('Token expirado');
    }

    return { valid: true, participantId: patient.participantId };
  }

  async acceptConsentToken(db, participantId, token) {
    await this.validateConsentToken(db, participantId, token);

    const patientsCollection = await this.getPatientsCollection(db);
    await patientsCollection.updateOne(
      { participantId },
      {
        $set: {
          status: 'ACTIVE',
          consentAcceptedAt: new Date(),
          consentToken: null,
          consentTokenExpiresAt: null,
          updatedAt: new Date()
        }
      }
    );

    return { success: true, participantId };
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

    if (patient.status !== 'PENDING_CONSENT') {
      throw new Error('Paciente não está pendente de consentimento');
    }

    const now = new Date();
    const expiresAt = patient.consentTokenExpiresAt ? new Date(patient.consentTokenExpiresAt) : null;
    const hasValidToken = Boolean(patient.consentToken && expiresAt && expiresAt > now);

    let token = patient.consentToken;
    let tokenCreatedAt = patient.consentTokenCreatedAt ? new Date(patient.consentTokenCreatedAt) : null;
    let tokenExpiresAt = expiresAt;

    if (!hasValidToken) {
      const consentMetadata = notificationService.buildConsentMetadata();
      token = consentMetadata.token;
      tokenCreatedAt = consentMetadata.createdAt;
      tokenExpiresAt = consentMetadata.expiresAt;
    }

    // RF005/RNF007 (#561/#564): patientName resolved via ParticipantIdentity
    // instead of read directly off the Patient document.
    const identityCollection = await this.getIdentityCollection(db);
    const rawIdentity = await identityCollection.findOne({ participantId });
    // #1104: patientName is civil identity -- decrypt before reading it, or a
    // ciphertext-only row sends the consent invitation with no name. This read
    // had no decryptIdentity anywhere in its path.
    const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;
    const patientWithIdentity = identity ? { ...patient, patientName: identity.patientName } : patient;

    const consentLink = notificationService.buildConsentLink(patientWithIdentity, token);
    await notificationService.enqueueConsentNotification(patientWithIdentity, consentLink);

    const updatePayload = {
      consentNotifiedAt: new Date(),
      updatedAt: new Date()
    };

    if (!hasValidToken) {
      updatePayload.consentToken = token;
      updatePayload.consentTokenCreatedAt = tokenCreatedAt;
      updatePayload.consentTokenExpiresAt = tokenExpiresAt;
    }

    await patientsCollection.updateOne(
      { _id: patient._id },
      { $set: updatePayload }
    );

    return {
      success: true,
      participantId,
      reusedToken: hasValidToken,
      consentTokenExpiresAt: tokenExpiresAt
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



