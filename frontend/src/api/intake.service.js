import { apiClient, notifyApiToast } from './client';
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';

const nowIso = () => new Date().toISOString();
const text = (v) => String(v || '').trim();

export async function registerClinicalIntake(payload = {}, options = {}) {
  const canonicalPayload = {
    participant: {
      participantId: text(payload.participant?.participantId),
      patientName: text(payload.participant?.patientName),
      birthDate: text(payload.participant?.birthDate),
      sex: text(payload.participant?.sex),
      email: text(payload.participant?.email),
      phone: text(payload.participant?.phone),
      identityDocument: text(payload.participant?.identityDocument),
      recordNumber: text(payload.participant?.recordNumber),
      isDeceased: Boolean(payload.participant?.isDeceased),
    },
    legalRepresentative: payload.legalRepresentative ? {
      name: text(payload.legalRepresentative.name),
      email: text(payload.legalRepresentative.email),
      identityDocument: text(payload.legalRepresentative.identityDocument),
      phone: text(payload.legalRepresentative.phone),
    } : null,
    consent: {
      consentTemplateId: text(payload.consent?.consentTemplateId),
      consentGranted: Boolean(payload.consent?.consentGranted),
      consentAcceptedAt: text(payload.consent?.consentAcceptedAt) || nowIso(),
    },
    specimen: {
      specimenId: text(payload.specimen?.specimenId),
      participantId: text(payload.specimen?.participantId || payload.participant?.participantId),
      sampleType: text(payload.specimen?.sampleType),
      sampleOrigin: text(payload.specimen?.sampleOrigin),
      extractionProtocol: text(payload.specimen?.extractionProtocol),
      barcode: text(payload.specimen?.barcode),
      quantity: payload.specimen?.quantity,
      unit: text(payload.specimen?.unit),
      registeredAt: text(payload.specimen?.registeredAt) || nowIso(),
      lifecycleStatus: text(payload.specimen?.lifecycleStatus),
      linkedProject: text(payload.specimen?.linkedProject),
      sprec: payload.specimen?.sprec || {},
      merkleRoot: text(payload.specimen?.merkleRoot),
    },
    diagnosis: payload.diagnosis || null,
    clinical: payload.clinical || { comorbidities: [], bloodPressure: '', clinicalObservations: '', diseasePhenotypes: [], diseaseBiomarkers: [], biomarkerValues: [], pharmacologyData: {} },
    biomarkers: Array.isArray(payload.biomarkers) ? payload.biomarkers : [],
  };

  const response = await apiClient.post('/intake-wizard', canonicalPayload);
  notifyDashboardDataChanged();
  if (options.notify !== false) {
    notifyApiToast({ message: 'Intake submetido com sucesso', type: 'success' });
  }
  return response.data;
}

export default { registerClinicalIntake };
