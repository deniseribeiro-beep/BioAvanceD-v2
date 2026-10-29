const { randomUUID } = require('crypto');

function buildSamplePayload(overrides = {}) {
  const uniqueToken = randomUUID().slice(0, 8);
  return {
    // participantId and registeredAt are the names Sample.validate requires;
    // locationID is still a field Sample writes.
    participantId: String(parseInt(uniqueToken, 16) % 100000000).padStart(8, '0'),
    sampleType: `Sangue-${uniqueToken}`,
    sampleOrigin: `Coleta-${uniqueToken}`,
    extractionProtocol: `Protocolo-${uniqueToken}`,
    quantity: 1,
    quality: 1,
    registeredAt: new Date().toISOString(),
    locationID: 101,
    linkedProject: `Projeto-${uniqueToken}`,
    ...overrides,
  };
}

module.exports = {
  buildSamplePayload,
};
