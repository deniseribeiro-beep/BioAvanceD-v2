// RF005/RNF007 (#575/#582): patientName/birthDate no longer live on Patient
// documents — the caller must resolve `identity` itself via
// participantIdentity.service.js#getIdentityByParticipantId (the sole
// authorized re-identification path, per that service's own comment) and
// pass the result in. This function stays a pure transform and never
// performs that lookup itself, so wiring it up can't bypass the
// authorization/audit boundary the re-identification flow requires.
function toFhirPatient(participant, identity) {
  return {
    resourceType: 'Patient',
    id: participant.participantId,
    identifier: participant.participantId ? [{ value: participant.participantId }] : [],
    name: identity?.patientName ? [{ use: 'official', text: identity.patientName }] : [],
    birthDate: identity?.birthDate || undefined,
    gender: participant.sex || 'unknown'
  };
}

// V2E-0544: closed has no FHIR Specimen.status code, so it is sent as
// `unavailable`. This is a lossy mapping: the dictionary asks for a governed
// mapping with a loss report, which this transform does not produce yet.
function toFhirSpecimenStatus(specimenStatus) {
  const status = String(specimenStatus || '').toLowerCase() || 'available';
  return status === 'closed' ? 'unavailable' : status;
}

function toFhirSpecimen(specimen) {
  return {
    resourceType: 'Specimen',
    id: specimen.specimenId,
    identifier: specimen.specimenId ? [{ value: specimen.specimenId }] : [],
    subject: specimen.participantId ? { reference: `Patient/${specimen.participantId}` } : undefined,
    receivedTime: specimen.registeredAt || undefined,
    status: toFhirSpecimenStatus(specimen.specimenStatus)
  };
}

function toFhirConsent(consent) {
  return {
    resourceType: 'Consent',
    id: consent.consentTemplateId,
    status: consent.consentGranted ? 'active' : 'inactive'
  };
}

function resultToFHIR(result) {
  return {
    observation: {
      resourceType: 'Observation',
      id: result.resultID || result._id || 'result'
    },
    diagnosticReport: {
      resourceType: 'DiagnosticReport',
      id: `dr-${result.resultID || result._id || 'result'}`
    }
  };
}

function temperatureToFHIR(temperature) {
  return {
    device: {
      resourceType: 'Device',
      id: `device-${temperature.sensorId || 'unknown'}`
    },
    observation: {
      resourceType: 'Observation',
      id: `temp-${temperature._id || temperature.timestamp || 'reading'}`
    }
  };
}

module.exports = {
  toFhirPatient,
  toFhirSpecimen,
  toFhirConsent,
  resultToFHIR,
  temperatureToFHIR,
  validateFHIRResource(resource) {
    if (!resource?.resourceType || !resource?.id) {
      throw new Error('Recurso FHIR inválido');
    }
    return true;
  }
};
