// backend/src/routes/intakeWizard.js
const express = require('express');
const router = express.Router();
const notificationService = require('../services/notification.service');
const patientIdentityService = require('../services/PatientIdentityService');
const { generateSampleHash } = require('../services/MerkleService');
const { getCollection } = require('../utils/collectionResolver');
const auditLogger = require('../utils/auditLogger');
const qualityDomain = require('../services/quality-domain.service');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function buildFallbackPatientID() {
  const digits = String(Date.now()).replace(/\D/g, '').slice(-8);
  return digits.padStart(8, '0');
}

function resolveRecipientAndTemplate(data = {}) {
  const demographic = data?.demographic || {};
  const representativeLegal = data?.representativeLegal || {};
  const consent = data?.consent || {};
  const sample = data?.sample || {};

  const patientName = normalizeString(demographic.patientName);
  const patientId = normalizeString(demographic.pseudoId || demographic.patientID || demographic.cpf || data?.pseudoId);
  const patientEmail = normalizeString(demographic.email);
  const representativeEmail = normalizeString(representativeLegal.email);
  const recipientEmail = patientEmail || representativeEmail;
  const templateId = normalizeString(consent.tcle_template_id || sample.selected_tcle);

  return {
    patientName,
    patientId,
    recipientEmail,
    templateId
  };
}

function resolvePatientID(data = {}) {
  const demographic = normalizeObject(data?.demographic);
  const sample = normalizeObject(data?.sample);
  const patientID = normalizeString(
    demographic.patientID
    || demographic.patientId
    || demographic.pseudoId
    || sample.patientID
    || sample.patientId
  );

  if (/^\d{8}$/.test(patientID)) {
    return patientID;
  }

  return buildFallbackPatientID();
}

function buildClinicalData(data = {}) {
  const diagnosis = normalizeObject(data?.diagnosis);
  const clinical = normalizeObject(data?.clinical);
  const integrity = normalizeObject(data?.integrity);

  return {
    orphaCode: normalizeString(diagnosis.orphaCode || diagnosis.orpha_code || integrity.diagnosis_orpha_code),
    omimCode: normalizeString(diagnosis.omimCode || diagnosis.omim_code || integrity.diagnosis_omim_code),
    cid: normalizeString(diagnosis.icdCode || diagnosis.icd_code || diagnosis.cid || integrity.diagnosis_cid_code),
    phenotypes: normalizeArray(clinical.diseasePhenotypes || integrity.disease_phenotypes),
    charlsonComorbidities: normalizeArray(clinical.charlsonConditions || integrity.charlson_conditions),
    biomarkers_values: normalizeObject(clinical.biomarkersValues || integrity.biomarkers_values),
  };
}

function buildPharmacologyData(data = {}) {
  const clinical = normalizeObject(data?.clinical);
  const integrity = normalizeObject(data?.integrity);
  const pharmacology = normalizeObject(clinical.pharmacologyData || integrity.pharmacology_data);

  const treatmentStatusRaw = normalizeString(pharmacology.treatment_status || pharmacology.treatmentStatus).toUpperCase();
  const treatmentStatus = ['NAIVE', 'TREATED', 'ON_TREATMENT', 'WASHOUT'].includes(treatmentStatusRaw) ? treatmentStatusRaw : '';
  const atcCode = normalizeString(pharmacology.atc_code || pharmacology.medication_code || pharmacology.medicationCode)
    .replace(/^ATC:/i, '')
    .toUpperCase();
  const atcLevel1 = normalizeString(pharmacology.atc_level_1 || pharmacology.medication_drug_class || pharmacology.medicationDrugClass)
    .toUpperCase() || (atcCode ? atcCode.charAt(0) : '');
  const drugName = normalizeString(pharmacology.drug_name || pharmacology.medication_name || pharmacology.medicationName);

  return {
    treatment_status: treatmentStatus,
    drug_name: drugName || null,
    atc_code: atcCode || null,
    atc_level_1: atcLevel1 || null,
    // Legacy aliases kept for consumers not yet migrated.
    medication_name: drugName || null,
    medication_code: atcCode || null,
    medication_drug_class: atcLevel1 || null,
    last_dose_date: normalizeString(pharmacology.last_dose_date || pharmacology.lastDoseDate) || null,
    washout_start_date: normalizeString(pharmacology.washout_start_date || pharmacology.washoutStartDate) || null,
    washout_end_date: normalizeString(pharmacology.washout_end_date || pharmacology.washoutEndDate) || null,
  };
}

function buildSampleDocumentFromIntake(data = {}, matchedPatient = null) {
  const sample = normalizeObject(data?.sample);
  const consent = normalizeObject(data?.consent);
  const integrity = normalizeObject(data?.integrity);
  const qualityCategoryRaw = normalizeString(sample.quality_category || sample.qualityCategory).toUpperCase();
  const qualityCategory = ['A', 'B', 'C'].includes(qualityCategoryRaw) ? qualityCategoryRaw : '';
  const releaseStatusRaw = normalizeString(sample.release_status || sample.releaseStatus).toUpperCase();
  const releaseStatus = ['QUARANTINE', 'AVAILABLE', 'BLOCKED'].includes(releaseStatusRaw) ? releaseStatusRaw : 'QUARANTINE';
  const registrationDate = sample.registrationDate || sample.registerDate || new Date().toISOString();
  const confirmedPatientID = normalizeString(matchedPatient?.patientID) || resolvePatientID(data);
  const confirmedPatientName = normalizeString(matchedPatient?.patientName || data?.demographic?.patientName);

  return {
    patientID: confirmedPatientID,
    patientName: confirmedPatientName || null,
    patient_name_confirmed: confirmedPatientName || null,
    patientObjectId: matchedPatient?._id || null,
    sampleType: normalizeString(sample.sampleType || sample.sprec?.sampleType || 'UNKNOWN'),
    sampleOrigin: normalizeString(sample.sampleOrigin || sample.sampleType || 'UNKNOWN'),
    extractionProtocol: normalizeString(sample.extractionProtocol || sample.protocolApplied || 'UNKNOWN'),
    barcode: normalizeString(sample.barcode) || null,
    registrationDate: new Date(registrationDate),
    registerDate: new Date(registrationDate),
    quantity: normalizeNumber(sample.quantity, 0),
    unit: normalizeString(sample.unit) || null,
    quality: normalizeString(sample.quality) || null,
    quality_score: normalizeNumber(sample.quality_score, null),
    quality_category: qualityCategory,
    linkedProject: normalizeString(sample.linkedProject || sample.linked_project) || 'INTAKE_WIZARD',
    currentStatus: normalizeString(sample.currentStatus) || 'Available',
    status: normalizeString(sample.status) || 'AVAILABLE',
    sprec: normalizeObject(sample.sprec),
    merkle_root: normalizeString(sample.merkle_root || integrity.merkle_root) || null,
    penalty_log: normalizeArray(sample.penalty_log || integrity.penalty_log),
    tcle_id: normalizeString(consent.tcle_template_id || sample.selected_tcle || integrity.selected_tcle) || null,
    consentTemplateId: normalizeString(consent.tcle_template_id || sample.selected_tcle || integrity.selected_tcle) || null,
    clinical_data: buildClinicalData(data),
    pharmacology_data: buildPharmacologyData(data),
    release_status: releaseStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function resolveMatchedPatient(db, data = {}) {
  const demographic = normalizeObject(data?.demographic);
  const representative = normalizeObject(data?.representativeLegal);

  const result = await patientIdentityService.matchOrUpsertPatient(db, {
    patientID: demographic.patientID || demographic.patientId || demographic.pseudoId,
    patientName: demographic.patientName,
    birthDate: parseBirthDate(demographic.birthDate),
    email: normalizeString(demographic.email || representative.email).toLowerCase() || null,
    sex: normalizeString(demographic.gender || demographic.sex).toUpperCase() || null,
    cpf: normalizeString(demographic.cpf || demographic.documento) || null,
    isDeceased: Boolean(demographic.isDeceased),
    representativeName: normalizeString(representative.name || demographic.representativeName) || null,
    representativeEmail: normalizeString(representative.email || demographic.representativeEmail).toLowerCase() || null,
    representativeCpf: normalizeString(representative.cpf || demographic.representativeCpf) || null,
  });

  return result;
}

async function ensureConsentEmailSent(payload) {
  const { patientName, patientId, recipientEmail, templateId } = resolveRecipientAndTemplate(payload);

  if (!patientName) {
    return { ok: false, status: 400, message: 'Nome do paciente é obrigatório para envio do TCLE.' };
  }

  if (!templateId) {
    return { ok: false, status: 400, message: 'Selecione um TCLE antes de finalizar o cadastro.' };
  }

  if (!recipientEmail) {
    return { ok: false, status: 400, message: 'E-mail do paciente ou representante é obrigatório para envio do TCLE.' };
  }

  const patientData = {
    patientID: patientId || `INTAKE-${Date.now()}`,
    patientName,
    email: recipientEmail,
  };

  const consentMetadata = notificationService.buildConsentMetadata();
  const consentLink = notificationService.buildConsentLink(patientData, consentMetadata.token);
  const emailResult = await notificationService.sendConsentEmail(patientData, consentLink);

  if (!emailResult?.success) {
    return { ok: false, status: 502, message: 'Não foi possível enviar o TCLE por e-mail. O cadastro não foi finalizado.', details: emailResult || null };
  }

  return {
    ok: true,
    consentEmail: {
      success: true,
      channel: emailResult.channel || 'email',
      provider: emailResult.provider || null,
      messageId: emailResult.messageId || null,
      to: emailResult.originalTo || emailResult.to || recipientEmail,
      consentLink,
      sentAt: new Date().toISOString(),
    }
  };
}

const resolverQualidadeMetodologica = qualityDomain.resolveMethodologicalQuality;
function calcularQualidade(samplePayloadOrTempo, temperatura) {
  if (typeof samplePayloadOrTempo === 'number') {
    const tempo = samplePayloadOrTempo;
    if (tempo <= 30 && temperatura <= 8) return 'Ótima';
    if (tempo <= 60 && temperatura <= 15) return 'Subótima';
    return 'Ruim';
  }

  return resolverQualidadeMetodologica(samplePayloadOrTempo);
}

async function handleIntakeWizard(req, res) {
  const data = req.body;

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Dados inválidos para intake wizard.' });
  }

  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível para persistir o intake wizard.',
      });
    }

    const consentEmailOutcome = await ensureConsentEmailSent(data);
    if (!consentEmailOutcome.ok) {
      return res.status(consentEmailOutcome.status).json({
        success: false,
        error: consentEmailOutcome.message,
        details: consentEmailOutcome.details || undefined,
      });
    }

    const qualidade = resolverQualidadeMetodologica(data?.sample || {});

    const matchOutcome = await resolveMatchedPatient(db, data);

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: matchOutcome?.patient?.patientID || null,
      resourceType: 'Patient',
      resourceId: matchOutcome?.patient?.patientID || null,
      status: 'success',
      result: 'success',
      severity: 'info',
      message: matchOutcome?.created
        ? 'Novo paciente criado durante intake wizard.'
        : 'Paciente existente identificado e atualizado durante intake wizard.',
      payload: {
        created: Boolean(matchOutcome?.created),
        matched: !Boolean(matchOutcome?.created),
        matchType: matchOutcome?.matchType || null,
        patientID: matchOutcome?.patient?.patientID || null,
      },
      req,
      module: 'Cadastro'
    });

    const samplesCollection = await getCollection(db, 'samples');
    const sampleToPersist = buildSampleDocumentFromIntake(data, matchOutcome.patient);
    sampleToPersist.quality_score = qualidade.score;
    sampleToPersist.quality_category = qualidade.category || sampleToPersist.quality_category;
    sampleToPersist.penalty_log = qualidade.penaltyLog;
    sampleToPersist.release_status = qualidade.forcedQuarantine ? 'QUARANTINE' : sampleToPersist.release_status;
    if (qualidade.sprec && Object.keys(qualidade.sprec).length > 0) {
      sampleToPersist.sprec = qualidade.sprec;
    }
    sampleToPersist.merkle_root = generateSampleHash(sampleToPersist);
    const insertResult = await samplesCollection.insertOne(sampleToPersist);
    const createdSample = await samplesCollection.findOne({ _id: insertResult.insertedId });

    const patientsCollection = await getCollection(db, 'patients');
    await patientsCollection.updateOne(
      { _id: matchOutcome.patient._id },
      {
        $set: {
          lastClinicalData: sampleToPersist.clinical_data || {},
          updatedAt: new Date(),
        },
        $addToSet: {
          linkedSampleIds: String(insertResult.insertedId),
        },
      }
    );

    return res.json({
      success: true,
      message: 'Cadastro integrado concluído com sucesso e TCLE enviado por e-mail.',
      qualidade: qualidade.label,
      qualityAssessment: {
        score: qualidade.score,
        category: qualidade.category,
        label: qualidade.label,
        forcedQuarantine: qualidade.forcedQuarantine,
        penaltyLog: qualidade.penaltyLog,
        reasons: qualidade.reasons,
        matrixType: qualidade.matrixType,
        source: qualidade.source,
        version: qualidade.version,
        quarantineReason: qualidade.quarantineReason,
      },
      patientMatch: {
        matched: !matchOutcome.created,
        created: matchOutcome.created,
        matchType: matchOutcome.matchType,
        patientID: matchOutcome.patient?.patientID || null,
      },
      consentEmail: consentEmailOutcome.consentEmail,
      data,
      sample: createdSample || { _id: insertResult.insertedId, ...sampleToPersist },
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: 'Falha ao enviar TCLE por e-mail. O cadastro não foi finalizado.',
      details: error?.message || 'Erro desconhecido no envio de e-mail',
    });
  }
}

router.get('/patient-match', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) {
    return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
  }

  const patientName = normalizeString(req.query?.patientName || req.query?.name);
  const birthDate = parseBirthDate(req.query?.birthDate);
  const patientID = normalizeString(req.query?.patientID || req.query?.patientId);

  if (!patientID && (!patientName || !birthDate)) {
    return res.status(400).json({ success: false, error: 'Informe patientID ou (patientName + birthDate).' });
  }

  try {
    const patientsCollection = await getCollection(db, 'patients');
    const patientNameNormalized = patientName
      ? patientName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
      : '';

    const birthDateKey = birthDate
      ? `${birthDate.getFullYear()}-${String(birthDate.getMonth() + 1).padStart(2, '0')}-${String(birthDate.getDate()).padStart(2, '0')}`
      : '';

    const patient = await patientsCollection.findOne(
      patientID
        ? {
          $or: [
            { patientID },
            ...(patientNameNormalized && birthDateKey ? [{ patientNameNormalized, birthDateKey }] : []),
          ],
        }
        : { patientNameNormalized, birthDateKey },
      {
        projection: {
          patientID: 1,
          patientName: 1,
          birthDate: 1,
          status: 1,
        },
      }
    );

    auditLogger.init(db);
    await auditLogger.log({
      action: 'PATIENT_MATCH_UPSERT',
      entity: 'Patient',
      entityID: patient?.patientID || patientID || null,
      resourceType: 'Patient',
      resourceId: patient?.patientID || patientID || null,
      status: 'success',
      result: 'success',
      severity: 'info',
      message: patient
        ? 'Heurística de intake encontrou paciente existente para upsert.'
        : 'Heurística de intake não encontrou paciente correspondente.',
      payload: {
        endpoint: '/patient-match',
        matched: Boolean(patient),
        query: {
          patientID: patientID || null,
          patientName: patientName || null,
          birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null,
        },
      },
      req,
      module: 'Cadastro'
    });

    return res.json({
      success: true,
      matched: Boolean(patient),
      patient: patient
        ? {
          patientID: normalizeString(patient.patientID),
          patientName: normalizeString(patient.patientName),
          birthDate: patient.birthDate || null,
          status: normalizeString(patient.status || 'ACTIVE'),
        }
        : null,
      message: patient
        ? 'Paciente identificado. Novos dados serão vinculados ao perfil histórico.'
        : '',
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || 'Falha ao consultar paciente.' });
  }
});

router.post('/', handleIntakeWizard);
router.post('/intake-wizard', handleIntakeWizard);

router._test = {
  normalizeString,
  normalizeNumber,
  normalizeArray,
  normalizeObject,
  parseBirthDate,
  buildFallbackPatientID,
  resolveRecipientAndTemplate,
  resolvePatientID,
  buildClinicalData,
  buildPharmacologyData,
  buildSampleDocumentFromIntake,
  resolveMatchedPatient,
  ensureConsentEmailSent,
  calcularQualidade,
  resolverQualidadeMetodologica,
};

module.exports = router;
