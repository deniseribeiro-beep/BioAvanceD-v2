const { randomUUID } = require('crypto');

function buildSamplePayload(overrides = {}) {
  const uniqueToken = randomUUID().slice(0, 8);
  return {
    patientID: uniqueToken.padStart(8, '0'),
    sampleType: `Sangue-${uniqueToken}`,
    sampleOrigin: `Coleta-${uniqueToken}`,
    extractionProtocol: `Protocolo-${uniqueToken}`,
    quantity: 1,
    quality: 1,
    registerDate: new Date().toISOString(),
    locationID: 101,
    linkedProject: `Projeto-${uniqueToken}`,
    ...overrides,
  };
}

module.exports = {
  buildSamplePayload,
};
