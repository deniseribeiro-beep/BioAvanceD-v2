function toFhirPatient(participant) {
  return {
    resourceType: 'Patient',
    id: participant.participantId,
    identifier: participant.participantId ? [{ value: participant.participantId }] : [],
    name: participant.patientName ? [{ use: 'official', text: participant.patientName }] : [],
    birthDate: participant.birthDate || undefined,
    gender: participant.sex || 'unknown'
  };
}

function toFhirSpecimen(specimen) {
  return {
    resourceType: 'Specimen',
    id: specimen.specimenId,
    identifier: specimen.specimenId ? [{ value: specimen.specimenId }] : [],
    subject: specimen.participantId ? { reference: `Patient/${specimen.participantId}` } : undefined,
    receivedTime: specimen.registeredAt || undefined,
    status: specimen.specimenStatus || 'available'
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
