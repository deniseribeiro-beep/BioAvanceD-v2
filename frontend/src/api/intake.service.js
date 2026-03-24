import { apiClient, notifyApiToast } from './client';
import { BIOMARKER_DICTIONARY } from '../config/constants/biomarkers.constants';

function extractResponseData(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function digitsOnly(value) {
  return normalizeText(value).replace(/\D/g, '');
}

function toIsoTimestamp(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function normalizeBirthDateForPayload(value) {
  const normalized = normalizeText(value);
  const digits = digitsOnly(normalized);

  if (digits.length === 8) {
    const day = digits.slice(0, 2);
    const month = digits.slice(2, 4);
    const year = digits.slice(4, 8);
    return `${year}-${month}-${day}T00:00:00.000Z`;
  }

  return normalized;
}

function normalizeCreatedEntity(entity, fallback = {}) {
  return entity && typeof entity === 'object' ? { ...fallback, ...entity } : { ...fallback };
}

function normalizePatientId(value) {
  return normalizeText(value);
}

function buildObservationPayload(observation, patientId, specimenId) {
  const collectedAt = toIsoTimestamp(observation?.collectedAt);
  const biomarkerType = String(observation?.biomarkerType || observation?.type || '').trim();
  const biomarkerDefinition = BIOMARKER_DICTIONARY.find((item) => item.id === biomarkerType);
  const codeText = biomarkerDefinition?.label || biomarkerType || 'Biomarcador';

  return {
    ...observation,
    patientID: patientId,
    sampleID: specimenId || observation?.sampleID || observation?.sampleId || null,
    sampleId: specimenId || observation?.sampleId || observation?.sampleID || null,
    specimenID: specimenId || observation?.specimenID || null,
    specimenId: specimenId || observation?.specimenId || null,
    collectedAt,
    resourceType: 'Observation',
    code: {
      text: codeText,
      coding: [
        {
          system: 'https://bioavanced.local/fhir/CodeSystem/biomarker',
          code: biomarkerType,
          display: codeText,
        },
      ],
    },
    subject: {
      reference: `Patient/${patientId}`,
    },
    specimen: specimenId
      ? {
          reference: `Specimen/${specimenId}`,
        }
      : undefined,
  };
}

function buildPartialResult({ stage, patient, sample, biomarkers, biomarkerErrors, message }) {
  return {
    success: false,
    partial: true,
    stage,
    patient,
    sample,
    biomarkers,
    biomarkerErrors,
    message,
  };
}

function normalizeApiError(error, fallback = 'Erro ao executar o cadastro integrado') {
  const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback;
  const normalizedError = new Error(message);
  normalizedError.cause = error;
  normalizedError.status = error?.response?.status;
  normalizedError.response = error?.response;
  return normalizedError;
}

async function createPatient(patientPayload) {
  const response = await apiClient.post('/patients', patientPayload);
  const data = extractResponseData(response);
  const patient = normalizeCreatedEntity(data, patientPayload);
  const patientId = normalizePatientId(patient.patientID || patient.patientId || patient.id || patient._id || patientPayload.patientID);

  if (!patientId) {
    throw new Error('O backend não retornou um identificador de paciente válido');
  }

  return {
    response,
    patient: {
      ...patient,
      patientID: patientId,
    },
    patientId,
  };
}

function flattenClinicalPayload(patientPayload = {}, clinicalPayload = {}) {
  const clinicalObservations = normalizeText(clinicalPayload?.clinicalObservations || clinicalPayload?.observations);
  const bloodPressure = normalizeText(clinicalPayload?.bloodPressure);

  return {
    ...patientPayload,
    notes: clinicalObservations || normalizeText(patientPayload.notes),
    bloodPressure: bloodPressure || undefined,
    hypertension: Boolean(patientPayload.hypertension),
    diabetesType1: Boolean(patientPayload.diabetesType1),
    diabetesType2: Boolean(patientPayload.diabetesType2),
    obesity: Boolean(patientPayload.obesity),
    copd: Boolean(patientPayload.copd),
    ckd: Boolean(patientPayload.ckd),
    asthma: Boolean(patientPayload.asthma),
    smoking: Boolean(patientPayload.smoking),
    alcoholUse: Boolean(patientPayload.alcoholUse),
    antibioticUse: Boolean(patientPayload.antibioticUse),
    insulinUse: Boolean(patientPayload.insulinUse),
    antiviralUse: Boolean(patientPayload.antiviralUse),
  };
}

function normalizeConsentPayload(consentPayload = {}, fallback = {}) {
  const acceptedAt = normalizeText(consentPayload?.consent_accepted_at || consentPayload?.consentAcceptedAt || fallback.consentAcceptedAt || new Date().toISOString());

  return {
    consentTemplateId: normalizeText(
      consentPayload?.tcle_template_id
      || consentPayload?.consentTemplateId
      || fallback.consentTemplateId
    ),
    consentAcceptedAt: acceptedAt,
    consentGranted: consentPayload?.consent_granted ?? consentPayload?.consentGranted ?? true,
  };
}

async function createSpecimen(samplePayload, patientId) {
  const response = await apiClient.post('/samples', {
    ...samplePayload,
    patientID: patientId,
  });
  const data = extractResponseData(response);
  const sample = normalizeCreatedEntity(data, samplePayload);
  const sampleId = normalizeText(sample.sampleID || sample.sampleId || sample.id || sample._id || data?.sampleID || data?._id);

  if (!sampleId) {
    throw new Error('O backend não retornou um identificador de amostra válido');
  }

  return {
    response,
    sample: {
      ...sample,
      patientID: patientId,
      sampleID: sample.sampleID || sampleId,
      sampleId,
    },
    sampleId,
  };
}

async function createObservation(observationPayload, patientId) {
  const response = await apiClient.post(`/patients/${encodeURIComponent(patientId)}/observations`, observationPayload);
  const data = extractResponseData(response);
  return normalizeCreatedEntity(data, observationPayload);
}

export async function registerClinicalIntake(payload = {}, options = {}) {
  const demographicPayload = payload.demographic || payload.patient || {};
  const representativePayload = payload.representativeLegal || payload.representative || {};
  const clinicalPayload = payload.clinical || {};
  const consentPayload = payload.consent || {};
  const normalizedConsent = normalizeConsentPayload(consentPayload, demographicPayload);
  const patientPayload = {
    ...demographicPayload,
    representativeName: normalizeText(representativePayload?.name || demographicPayload?.representativeName),
    representativeEmail: normalizeText(representativePayload?.email || demographicPayload?.representativeEmail).toLowerCase(),
    representativeCpf: digitsOnly(representativePayload?.cpf || demographicPayload?.representativeCpf),
    representativePhone: digitsOnly(representativePayload?.phone || demographicPayload?.representativePhone),
    consentTemplateId: normalizedConsent.consentTemplateId,
    consentAcceptedAt: normalizedConsent.consentAcceptedAt,
  };
  const { sample: samplePayload, specimen: specimenPayload, biomarkers = [] } = payload;
  const notify = options.notify !== false;
  const biomarkerList = Array.isArray(biomarkers) ? biomarkers : Array.isArray(payload.observations) ? payload.observations : [];
  const specimenData = specimenPayload || samplePayload;

  if (!patientPayload || typeof patientPayload !== 'object') {
    throw new Error('Dados do paciente são obrigatórios para o cadastro integrado');
  }

  if (!specimenData || typeof specimenData !== 'object') {
    throw new Error('Dados da amostra são obrigatórios para o cadastro integrado');
  }

  const normalizedPatientPayload = flattenClinicalPayload({
    ...patientPayload,
    patientID: undefined,
    birthDate: normalizeBirthDateForPayload(patientPayload.birthDate),
    email: normalizeText(patientPayload.email).toLowerCase(),
    isDeceased: Boolean(patientPayload.isDeceased),
    phone: digitsOnly(patientPayload.phone),
    cpf: digitsOnly(patientPayload.cpf),
    representativeName: normalizeText(patientPayload.representativeName),
    representativeEmail: normalizeText(patientPayload.representativeEmail).toLowerCase(),
    representativeCpf: digitsOnly(patientPayload.representativeCpf),
    representativePhone: digitsOnly(patientPayload.representativePhone),
    consentTemplateId: normalizeText(patientPayload.consentTemplateId),
    consentAcceptedAt: normalizeText(patientPayload.consentAcceptedAt),
  }, clinicalPayload);

  const result = {
    success: false,
    partial: false,
    stage: null,
    patient: null,
    sample: null,
    specimen: null,
    biomarkers: [],
    biomarkerErrors: [],
    message: '',
  };

  try {
    const patientOutcome = await createPatient(normalizedPatientPayload);
    result.patient = patientOutcome.patient;
    result.stage = 'patient';

    const specimenOutcome = await createSpecimen(specimenData, patientOutcome.patientId);
    result.sample = specimenOutcome.sample;
    result.specimen = specimenOutcome.sample;
    result.stage = 'specimen';

    for (const biomarker of biomarkerList) {
      try {
        const observationPayload = buildObservationPayload(biomarker, patientOutcome.patientId, specimenOutcome.sampleId);
        const observation = await createObservation(observationPayload, patientOutcome.patientId);
        result.biomarkers.push(observation);
      } catch (error) {
        const normalizedError = normalizeApiError(error, 'Falha ao registrar um biomarcador');
        result.biomarkerErrors.push({
          biomarkerType: biomarker?.biomarkerType || biomarker?.type || 'unknown',
          message: normalizedError.message,
        });
      }
    }

    result.success = result.biomarkerErrors.length === 0;
    result.partial = result.biomarkerErrors.length > 0;
    result.stage = result.biomarkerErrors.length > 0 ? 'biomarkers' : 'completed';
    result.message = result.biomarkerErrors.length > 0
      ? 'Paciente e Amostra criados com sucesso! Alguns biomarcadores não puderam ser registrados.'
      : 'Paciente e Amostra criados com sucesso!';

    if (notify) {
      notifyApiToast({
        message: result.message,
        type: result.partial ? 'warning' : 'success',
        duration: result.partial ? 5500 : 4000,
      });
    }

    return result;
  } catch (error) {
    const normalizedError = normalizeApiError(error);

    if (!result.patient) {
      if (notify) {
        notifyApiToast({
          message: `Erro ao criar paciente: ${normalizedError.message}`,
          type: 'error',
          duration: 4500,
        });
      }
      throw normalizedError;
    }

    if (!result.sample) {
      const partialResult = buildPartialResult({
        stage: 'specimen',
        patient: result.patient,
        sample: null,
        biomarkers: [],
        biomarkerErrors: [],
        message: `Erro ao criar amostra: o paciente foi cadastrado, mas a amostra falhou. ${normalizedError.message}`,
      });

      if (notify) {
        notifyApiToast({
          message: partialResult.message,
          type: 'warning',
          duration: 5500,
        });
      }

      return partialResult;
    }

    const partialResult = buildPartialResult({
      stage: 'biomarkers',
      patient: result.patient,
      sample: result.sample,
      biomarkers: result.biomarkers,
      biomarkerErrors: result.biomarkerErrors,
      message: `Paciente e Amostra criados com sucesso! Houve falha no registro de biomarcadores: ${normalizedError.message}`,
    });

    if (notify) {
      notifyApiToast({
        message: partialResult.message,
        type: 'warning',
        duration: 5500,
      });
    }

    return partialResult;
  }
}

export default {
  createPatient,
  createSpecimen,
  createObservation,
  registerClinicalIntake,
};
