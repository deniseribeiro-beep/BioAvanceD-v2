jest.mock('../../src/config/uploadConfig', () => ({ STORAGE_BASE: '/tmp/bioavance-test-storage' }));
jest.mock('../../src/utils/fileCrypto', () => ({
  assertFileEncryptionConfigured: () => {},
  encryptFileBuffer: () => null,
  decryptFileBuffer: (b) => b,
  computeChecksum: () => 'abc',
}));
jest.mock('../../src/services/tclePdf', () => ({
  buildSignedTclePdf: () => Buffer.from('%PDF'),
}));

const {
  buildConsentEvidenceDocument,
} = require('../../src/services/consentEvidence.service');

describe('consentEvidence identity proof', () => {
  const template = { _id: 't1', version: 1, content: 'termo' };

  it('defaults identityProvider to panel', () => {
    const doc = buildConsentEvidenceDocument({
      consentId: 'c1',
      participantId: 'P1',
      template,
      responses: { a: true },
      decisionDateTime: new Date('2026-11-26T12:00:00Z'),
      location: { status: 'unavailable' },
    });
    expect(doc.identity.identityProvider).toBe('panel');
    expect(doc.origin.location).toEqual({ status: 'unavailable' });
  });

  it('records gov.br sub', () => {
    const doc = buildConsentEvidenceDocument({
      consentId: 'c1',
      participantId: 'P1',
      template,
      responses: {},
      decisionDateTime: new Date(),
      identityProof: { provider: 'govbr', sub: 'gov-sub-1', email: 'a@b.gov.br' },
    });
    expect(doc.identity.identityProvider).toBe('govbr');
    expect(doc.identity.govbrSub).toBe('gov-sub-1');
  });

  it('records ICP-Brasil thumbprint', () => {
    const doc = buildConsentEvidenceDocument({
      consentId: 'c1',
      participantId: 'P1',
      template,
      responses: {},
      decisionDateTime: new Date(),
      identityProof: {
        provider: 'icp-brasil',
        certificateThumbprint: 'AB:CD',
        signedTermHash: 'sha256:x',
      },
    });
    expect(doc.identity.identityProvider).toBe('icp-brasil');
    expect(doc.identity.certificateThumbprint).toBe('AB:CD');
  });
});
