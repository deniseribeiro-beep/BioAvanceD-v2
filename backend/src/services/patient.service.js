const PatientModel = require('../models/Patient');
const ClinicalUnitModel = require('../models/ClinicalUnit');
const logger = require('../utils/logger');
const { generateUniquePatientID, sanitizePatientForLogs } = require('../utils/patientAnonymization');
const notificationService = require('./notification.service');
const fhirSyncService = require('./fhir-sync.service');
const { getCollection } = require('../utils/collectionResolver');

/**
 * Service de Pacientes
 * RF005 - Cadastro de Paciente com Anonimização LGPD
 */
class PatientService {
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
      rawClinicalUnitId === null || rawClinicalUnitId === ''
        ? null
        : String(rawClinicalUnitId).trim();

    const normalizedClinicalUnitName =
      rawClinicalUnitName === null || rawClinicalUnitName === ''
        ? null
        : String(rawClinicalUnitName).trim();

    if (!normalizedClinicalUnitId && !normalizedClinicalUnitName) {
      return {
        clinicalUnitId: null,
        clinicalUnit: null,
        unitAcronym: null
      };
    }

    const { ObjectId } = require('mongodb');
    const clinicalUnitsCollection = await getCollection(db, 'clinicalUnits');

    if (normalizedClinicalUnitId) {
      if (!ObjectId.isValid(normalizedClinicalUnitId)) {
        throw new Error('clinicalUnitId inválido');
      }

      const clinicalUnitById = await clinicalUnitsCollection.findOne({ _id: new ObjectId(normalizedClinicalUnitId) });
      if (!clinicalUnitById) {
        throw new Error('Unidade clínica não encontrada');
      }

      const resolvedName = String(clinicalUnitById.name || '').trim();
      return {
        clinicalUnitId: String(clinicalUnitById._id),
        clinicalUnit: resolvedName || null,
        unitAcronym: String(clinicalUnitById.acronym || '').trim() || PatientModel.fillAcronym(resolvedName)
      };
    }

    if (!normalizedClinicalUnitName) {
      return {
        clinicalUnitId: null,
        clinicalUnit: null,
        unitAcronym: null
      };
    }

    const normalizedName = ClinicalUnitModel.normalizeName(normalizedClinicalUnitName);
    const clinicalUnitByName = await clinicalUnitsCollection.findOne({ normalizedName });

    if (clinicalUnitByName) {
      const resolvedName = String(clinicalUnitByName.name || '').trim();
      return {
        clinicalUnitId: String(clinicalUnitByName._id),
        clinicalUnit: resolvedName || null,
        unitAcronym: String(clinicalUnitByName.acronym || '').trim() || PatientModel.fillAcronym(resolvedName)
      };
    }

    const fallbackClinicalUnit = this.normalizeClinicalUnit(normalizedClinicalUnitName);
    return {
      clinicalUnitId: null,
      clinicalUnit: fallbackClinicalUnit,
      unitAcronym: fallbackClinicalUnit ? PatientModel.fillAcronym(fallbackClinicalUnit) : null
    };
  }

  normalizeRepresentativeCpf(value) {
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
      payload.representativeCpf = null;
      payload.representativePhone = null;
      return;
    }

    const representativeName = typeof payload.representativeName === 'string' ? payload.representativeName.trim() : '';
    const representativeCpf = this.normalizeRepresentativeCpf(payload.representativeCpf);
    const representativePhone = this.normalizeRepresentativePhone(payload.representativePhone);

    if (!representativeName || !representativeCpf || !representativePhone) {
      throw new Error('Para paciente falecido, nome, CPF e telefone do representante legal são obrigatórios');
    }

    if (representativeCpf.length !== 11) {
      throw new Error('CPF do representante legal inválido. Informe 11 dígitos');
    }

    if (representativePhone.length < 10 || representativePhone.length > 15) {
      throw new Error('Telefone do representante legal inválido. Informe de 10 a 15 dígitos');
    }

    payload.representativeName = representativeName;
    payload.representativeCpf = representativeCpf;
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

  normalizeCpf(cpf) {
    if (cpf === undefined || cpf === null) return null;
    const normalized = String(cpf).replace(/\D/g, '').trim();
    return normalized || null;
  }

  normalizeRecordNumber(recordNumber) {
    if (recordNumber === undefined || recordNumber === null) return null;
    const normalized = String(recordNumber).trim();
    return normalized || null;
  }

  async checkIdentifierConflict(db, patientData) {
    const patientsCollection = await getCollection(db, 'patients');
    const normalizedCpf = this.normalizeCpf(patientData?.cpf);
    const normalizedRecordNumber = this.normalizeRecordNumber(patientData?.recordNumber);

    const orFilters = [];
    if (normalizedCpf) {
      orFilters.push({ cpf: normalizedCpf });
    }
    if (normalizedRecordNumber) {
      orFilters.push({ recordNumber: normalizedRecordNumber });
    }

    if (orFilters.length === 0) {
      return null;
    }

    const existing = await patientsCollection.findOne({ $or: orFilters });
    if (!existing) {
      return null;
    }

    if (normalizedCpf && String(existing.cpf || '').replace(/\D/g, '') === normalizedCpf) {
      return { field: 'cpf', value: normalizedCpf, existing };
    }

    if (normalizedRecordNumber && String(existing.recordNumber || '').trim() === normalizedRecordNumber) {
      return { field: 'recordNumber', value: normalizedRecordNumber, existing };
    }

    return { field: 'identifier', value: null, existing };
  }

  /**
   * Verifica se um paciente já existe (duplicidade)
   * Critério: nome + data de nascimento (normalizada)
   */
  async checkDuplicatePatient(db, patientData) {
    try {
      const patientsCollection = await getCollection(db, 'patients');
      
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
      
      // Busca todos os pacientes e verifica manualmente (mais confiável para comparação de strings)
      // Alternativa: usar índice composto se necessário para performance
      const allPatients = await patientsCollection.find({
        birthDate: {
          $gte: new Date(normalizedBirthDate.getFullYear(), normalizedBirthDate.getMonth(), normalizedBirthDate.getDate()),
          $lt: new Date(normalizedBirthDate.getFullYear(), normalizedBirthDate.getMonth(), normalizedBirthDate.getDate() + 1)
        }
      }).toArray();
      
      // Verifica se algum paciente tem o mesmo nome normalizado
      for (const patient of allPatients) {
        if (patient.patientName && patient.birthDate) {
          const existingName = patient.patientName.trim().toLowerCase().replace(/\s+/g, ' ');
          const existingDate = patient.birthDate instanceof Date 
            ? new Date(patient.birthDate.getFullYear(), patient.birthDate.getMonth(), patient.birthDate.getDate())
            : new Date(patient.birthDate);
          
          if (existingName === normalizedName && 
              existingDate.getTime() === normalizedBirthDate.getTime()) {
            return patient;
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.error('Erro ao verificar duplicidade de paciente:', error.message);
      return null; // Em caso de erro, permite continuar (não bloqueia)
    }
  }

  async createPatient(db, patientData) {
    try {
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
      }

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

      const validation = PatientModel.validate(patientData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      patientData.cpf = this.normalizeCpf(patientData.cpf);
      patientData.recordNumber = this.normalizeRecordNumber(patientData.recordNumber);

      const identifierConflict = await this.checkIdentifierConflict(db, patientData);
      if (identifierConflict) {
        const conflictError = new Error(
          identifierConflict.field === 'cpf'
            ? `CPF ${identifierConflict.value} já cadastrado no sistema.`
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

      // Valida unidade clínica
      if (patientData.clinicalUnit && !PatientModel.validateUnit(patientData.clinicalUnit)) {
        throw new Error('Unidade clínica inválida');
      }

      // Gera sigla da unidade por iniciais e garante uppercase
      if (patientData.clinicalUnit) {
        patientData.unitAcronym = PatientModel.fillAcronym(patientData.clinicalUnit);
      }
      if (patientData.unitAcronym) {
        patientData.unitAcronym = String(patientData.unitAcronym).toUpperCase();
      }

      // GERA ID ÚNICO DE 8 DÍGITOS AUTOMATICAMENTE (LGPD)
      // Remove patientID se fornecido - será gerado automaticamente
      delete patientData.patientID;
      
      // Remove campo height se existir (não deve ser salvo no banco)
      delete patientData.height;
      
      // Gera ID único criptograficamente seguro
      const patientID = await generateUniquePatientID(db);
      patientData.patientID = patientID;

      const consentMetadata = notificationService.buildConsentMetadata();
      patientData.status = 'PENDING_CONSENT';
      patientData.consentToken = consentMetadata.token;
      patientData.consentTokenCreatedAt = consentMetadata.createdAt;
      patientData.consentTokenExpiresAt = consentMetadata.expiresAt;

      const patientsCollection = await getCollection(db, 'patients');
      const patient = PatientModel.create(patientData);

      const result = await patientsCollection.insertOne(patient);

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

      // Log sanitizado (sem dados sensíveis)
      const sanitizedData = sanitizePatientForLogs(patient);
      logger.info('Paciente criado:', sanitizedData);

      await fhirSyncService.upsertPatientFromLegacy(db, {
        _id: result.insertedId,
        ...patient
      });

      // Retorna paciente com ID gerado
      return {
        _id: result.insertedId,
        ...patient,
        patientID: patientID // ID gerado automaticamente
      };
    } catch (error) {
      logger.error('Erro ao criar paciente:', error.message);
      throw error;
    }
  }

  async getPatient(db, patientID) {
    try {
      const patientFromFhir = await fhirSyncService.getPatientFhirFirst(db, patientID);
      if (patientFromFhir) {
        return patientFromFhir;
      }

      const patientsCollection = await getCollection(db, 'patients');
      // Busca por patientID (string de 8 dígitos) ou _id (ObjectId)
      let patient;
      if (typeof patientID === 'string' && patientID.length === 8 && /^\d{8}$/.test(patientID)) {
        // É um patientID de 8 dígitos
        patient = await patientsCollection.findOne({ patientID });
      } else {
        // É um ObjectId
        const { ObjectId } = require('mongodb');
        patient = await patientsCollection.findOne({ _id: new ObjectId(patientID) });
      }
      return patient;
    } catch (error) {
      logger.error('Erro ao buscar paciente:', error.message);
      throw error;
    }
  }

  async listPatients(db, filters = {}) {
    try {
      const listFromFhir = await fhirSyncService.listPatientsFhirFirst(db, filters);
      if (listFromFhir) {
        return listFromFhir;
      }

      const patientsCollection = await getCollection(db, 'patients');
      const query = {};

      if (filters.patientName) {
        query.patientName = { $regex: filters.patientName, $options: 'i' };
      }

      if (filters.clinicalUnit) {
        query.clinicalUnit = filters.clinicalUnit;
      }

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      const patients = await patientsCollection
        .find(query)
        .limit(limit)
        .skip(skip)
        .toArray();

      const total = await patientsCollection.countDocuments(query);

      return { patients, total, limit, skip };
    } catch (error) {
      logger.error('Erro ao listar pacientes:', error.message);
      throw error;
    }
  }

  /**
   * Busca pacientes por múltiplos critérios (exceto nome e histórico clínico)
   * Permite busca por: patientID, recordNumber, birthDate, clinicalUnit, unitAcronym, icdCode, etc.
   */
  async searchPatients(db, searchTerm) {
    try {
      const searchFromFhir = await fhirSyncService.searchPatientsFhirFirst(db, searchTerm);
      if (searchFromFhir) {
        return searchFromFhir;
      }

      const patientsCollection = await getCollection(db, 'patients');
      
      if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
        return { patients: [], total: 0 };
      }

      const term = searchTerm.trim();
      const query = { $or: [] };

      // Busca por patientID (8 dígitos)
      if (/^\d{8}$/.test(term)) {
        query.$or.push({ patientID: term });
      }

      // Busca por recordNumber (número ou string)
      query.$or.push({ recordNumber: { $regex: term, $options: 'i' } });
      
      // Tenta como número também
      const numTerm = parseInt(term, 10);
      if (!isNaN(numTerm)) {
        query.$or.push({ recordNumber: numTerm });
      }

      // Busca por data de nascimento (formato DD/MM/YYYY ou YYYY-MM-DD)
      if (term.includes('/') || term.includes('-')) {
        let searchDate;
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
              const startDate = new Date(year, month, day);
              const endDate = new Date(year, month, day + 1);
              query.$or.push({
                birthDate: {
                  $gte: startDate,
                  $lt: endDate
                }
              });
            }
          }
        } else if (term.includes('-')) {
          // Formato YYYY-MM-DD
          searchDate = new Date(term);
          if (!isNaN(searchDate.getTime())) {
            const year = searchDate.getFullYear();
            const month = searchDate.getMonth();
            const day = searchDate.getDate();
            const startDate = new Date(year, month, day);
            const endDate = new Date(year, month, day + 1);
            query.$or.push({
              birthDate: {
                $gte: startDate,
                $lt: endDate
              }
            });
          }
        }
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

      const patients = await patientsCollection.find(query).limit(50).toArray();
      const total = await patientsCollection.countDocuments(query);

      return { patients, total };
    } catch (error) {
      logger.error('Erro ao buscar pacientes:', error.message);
      throw error;
    }
  }

  async updatePatient(db, patientID, updateData) {
    try {
      const patientsCollection = await getCollection(db, 'patients');

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

      if (updateData.phone !== undefined) {
        const normalizedPhone = this.normalizePhone(updateData.phone);
        if (updateData.phone !== null && updateData.phone !== '' && (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 15)) {
          throw new Error('Telefone (phone) inválido. Informe de 10 a 15 dígitos');
        }
        updateData.phone = normalizedPhone;
      }

      if (updateData.clinicalUnit !== undefined || updateData.clinicalUnitId !== undefined) {
        const clinicalUnitSnapshot = await this.resolveClinicalUnitSnapshot(db, updateData);
        if (clinicalUnitSnapshot) {
          updateData.clinicalUnitId = clinicalUnitSnapshot.clinicalUnitId;
          updateData.clinicalUnit = clinicalUnitSnapshot.clinicalUnit;
          updateData.unitAcronym = clinicalUnitSnapshot.unitAcronym;
        }
      }

      if (updateData.isDeceased !== undefined ||
        updateData.representativeName !== undefined ||
        updateData.representativeCpf !== undefined ||
        updateData.representativePhone !== undefined) {
        const existingPatient = await this.getPatient(db, patientID);
        const mergedPayload = {
          isDeceased: existingPatient?.isDeceased,
          representativeName: existingPatient?.representativeName,
          representativeCpf: existingPatient?.representativeCpf,
          representativePhone: existingPatient?.representativePhone,
          ...updateData
        };
        this.applyDeceasedRepresentativeRules(mergedPayload);
        updateData.isDeceased = mergedPayload.isDeceased;
        updateData.representativeName = mergedPayload.representativeName;
        updateData.representativeCpf = mergedPayload.representativeCpf;
        updateData.representativePhone = mergedPayload.representativePhone;
      }
      
      // Validação antes de atualizar
      if (updateData.patientID) {
        // Não permite alterar o patientID (é imutável por LGPD)
        delete updateData.patientID;
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

      // Busca por patientID (string de 8 dígitos) ou _id (ObjectId)
      let query;
      if (typeof patientID === 'string' && patientID.length === 8 && /^\d{8}$/.test(patientID)) {
        // É um patientID de 8 dígitos
        query = { patientID };
      } else {
        // É um ObjectId
        const { ObjectId } = require('mongodb');
        query = { _id: new ObjectId(patientID) };
      }

      const result = await patientsCollection.updateOne(
        query,
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        throw new Error('Paciente não encontrado');
      }

      // Log sanitizado
      const sanitizedData = sanitizePatientForLogs({ patientID: typeof patientID === 'string' && patientID.length === 8 ? patientID : 'N/A' });
      logger.info('Paciente atualizado:', sanitizedData);

      return { success: true };
    } catch (error) {
      logger.error('Erro ao atualizar paciente:', error.message);
      throw error;
    }
  }

  async validateConsentToken(db, patientID, token) {
    if (!patientID || !token) {
      throw new Error('patientId e token são obrigatórios');
    }

    const patientsCollection = await getCollection(db, 'patients');
    const query = { patientID };
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

    return { valid: true, patientID: patient.patientID };
  }

  async acceptConsentToken(db, patientID, token) {
    await this.validateConsentToken(db, patientID, token);

    const patientsCollection = await getCollection(db, 'patients');
    await patientsCollection.updateOne(
      { patientID },
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

    return { success: true, patientID };
  }

  async resendConsentNotification(db, patientID) {
    if (!patientID) {
      throw new Error('patientId é obrigatório');
    }

    const patientsCollection = await getCollection(db, 'patients');
    const patient = await patientsCollection.findOne({ patientID });

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

    const consentLink = notificationService.buildConsentLink(patient, token);
    await notificationService.enqueueConsentNotification(patient, consentLink);

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
      patientID,
      reusedToken: hasValidToken,
      consentTokenExpiresAt: tokenExpiresAt
    };
  }

  async deletePatient(db, patientID) {
    try {
      const patientsCollection = await getCollection(db, 'patients');
      
      // Busca por patientID (string de 8 dígitos) ou _id (ObjectId)
      let query;
      if (typeof patientID === 'string' && patientID.length === 8 && /^\d{8}$/.test(patientID)) {
        // É um patientID de 8 dígitos
        query = { patientID };
      } else {
        // É um ObjectId
        const { ObjectId } = require('mongodb');
        query = { _id: new ObjectId(patientID) };
      }
      
      const result = await patientsCollection.deleteOne(query);
      
      // Log sanitizado
      const sanitizedData = sanitizePatientForLogs({ patientID: typeof patientID === 'string' && patientID.length === 8 ? patientID : 'N/A' });
      logger.info('Paciente deletado:', sanitizedData);
      
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Erro ao deletar paciente:', error.message);
      throw error;
    }
  }
}

module.exports = new PatientService();

