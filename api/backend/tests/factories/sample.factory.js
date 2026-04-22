function buildSamplePayload(overrides = {}) {
  return {
    patientID: '12345678',
    sampleType: 'Sangue',
    sampleOrigin: 'Coleta',
    extractionProtocol: 'Protocolo A',
    quantity: 1,
    quality: 1,
    registerDate: new Date().toISOString(),
    locationID: 101,
    linkedProject: 'Projeto QA',
    ...overrides,
  };
}

module.exports = {
  buildSamplePayload,
};
