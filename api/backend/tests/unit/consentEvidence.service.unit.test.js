/**
 * #827: every Consent lacked dict-02's 1..1 Core evidence trio
 * (evidenceDocumentUri ELM-0105, evidenceHash ELM-0106, evidenceMimeType
 * P1X-0373). consentEvidence.service is where the evidence document is
 * built and stored; these tests pin what it binds together and that it
 * goes through RF007's encrypted object-storage path, fail-closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const fs = require('fs');
const crypto = require('crypto');
const keyRegistry = require('../../src/config/keyRegistry');
const fileCrypto = require('../../src/utils/fileCrypto');
const consentEvidence = require('../../src/services/consentEvidence.service');

const template = {
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'TCLE Biobanco',
  version: '3',
  versionGroupId: 'group-1',
  htmlContent: '<p>Termo exato apresentado</p>',
};

const input = {
  consentId: 'c0ffee00-0000-4000-8000-000000000001',
  participantId: '12345678',
  template,
  responses: { analytics: true, contact: false },
  decisionDateTime: new Date('2026-09-24T12:00:00Z'),
  signatureHash: null,
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
};

describe('#827 consentEvidence.buildConsentEvidenceDocument', () => {
  it('binds the exact term text (by hash), its version, the answers and the origin', () => {
    const doc = consentEvidence.buildConsentEvidenceDocument(input);

    const expectedTermHash = crypto.createHash('sha256').update(template.htmlContent, 'utf8').digest('hex');
    expect(doc.termContentHash).toBe(`sha256:${expectedTermHash}`);
    expect(doc.consentVersion).toBe('3');
    expect(doc.consentTemplateId).toBe(template._id);
    expect(doc.responses).toEqual({ analytics: true, contact: false });
    expect(doc.decisionDateTime).toBe('2026-09-24T12:00:00.000Z');
    expect(doc.signerRole).toBe('participant');
    expect(doc.origin).toEqual({ ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0' });
  });

  it('records the collection place beside the origin when the signature was taken in person', () => {
    const doc = consentEvidence.buildConsentEvidenceDocument({ ...input, collectionPlace: ' Laboratório Central ' });
    expect(doc.origin.collectionPlace).toBe('Laboratório Central');
    expect(doc.decisionDateTime).toBe('2026-09-24T12:00:00.000Z');
  });
});

describe('#827 consentEvidence.storeConsentEvidence', () => {
  const originalOptOut = process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
  let written;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
    written = null;
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation((p, data) => {
      written = { path: p, data };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalOptOut === undefined) delete process.env.ALLOW_UNENCRYPTED_FILE_STORAGE;
    else process.env.ALLOW_UNENCRYPTED_FILE_STORAGE = originalOptOut;
  });

  it('stores the signed TCLE pdf beside the evidence when a signature image is present', () => {
    const key = Buffer.alloc(32, 7);
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(key);
    vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');
    vi.spyOn(keyRegistry, 'getKeyById').mockReturnValue(key);
    const writes = [];
    fs.writeFileSync.mockImplementation((filePath, data) => {
      writes.push({ path: String(filePath), data });
      written = { path: filePath, data };
    });

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    const result = consentEvidence.storeConsentEvidence({
      ...input,
      collectionPlace: 'Laboratório Central',
      signatureImageBase64: `data:image/png;base64,${png.toString('base64')}`,
    });

    expect(result.signedTcleDocumentUri).toBe(`objstore://consents/${input.consentId}/tcle.pdf`);
    expect(result.signedTcleHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.evidenceDocumentUri).toMatch(/evidence\.json$/);
    const pdfWrite = writes.find((entry) => entry.path.replace(/\\/g, '/').endsWith('tcle.pdf'));
    const pdf = fileCrypto.decryptFileBuffer(pdfWrite.data, {
      encryptionKeyId: 'k1',
      encryptionIv: result.signedTcleEncryption.iv,
      encryptionTag: result.signedTcleEncryption.tag,
    });
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('Laborat');
  });

  it('reads the signed TCLE back and refuses a consent that has no document', () => {
    const key = Buffer.alloc(32, 7);
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(key);
    vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');
    vi.spyOn(keyRegistry, 'getKeyById').mockReturnValue(key);
    const files = new Map();
    fs.writeFileSync.mockImplementation((filePath, data) => {
      files.set(String(filePath), data);
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => files.has(String(filePath)));
    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath) => files.get(String(filePath)));

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    const stored = consentEvidence.storeConsentEvidence({
      ...input,
      signatureImageBase64: `data:image/png;base64,${png.toString('base64')}`,
    });

    const pdf = consentEvidence.readSignedTcle({
      signedTcleDocumentUri: stored.signedTcleDocumentUri,
      signedTcleHash: stored.signedTcleHash,
      signedTcleEncryption: stored.signedTcleEncryption,
    });
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(consentEvidence.readSignedTcle({ signedTcleDocumentUri: null })).toBeNull();
  });

  it('stores the evidence encrypted and returns the three dictionary fields', () => {
    const key = Buffer.alloc(32, 7);
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(key);
    vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');
    vi.spyOn(keyRegistry, 'getKeyById').mockReturnValue(key);

    const result = consentEvidence.storeConsentEvidence(input);

    expect(result.evidenceDocumentUri).toBe(`objstore://consents/${input.consentId}/evidence.json`);
    expect(result.evidenceMimeType).toBe('application/json');
    expect(result.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.evidenceEncryption).toMatchObject({ algorithm: 'aes-256-gcm', keyId: 'k1' });

    // What is on disk is ciphertext, and it decrypts to the document the
    // hash was computed over -- the hash proves the plaintext, not the blob.
    expect(written.path.replace(/\\/g, '/')).toMatch(new RegExp(`consents/${input.consentId}/evidence\\.json$`));
    expect(written.data.toString('utf8')).not.toContain('12345678');
    const plaintext = fileCrypto.decryptFileBuffer(written.data, {
      encryptionKeyId: 'k1',
      encryptionIv: result.evidenceEncryption.iv,
      encryptionTag: result.evidenceEncryption.tag,
    });
    expect(`sha256:${fileCrypto.computeChecksum(plaintext)}`).toBe(result.evidenceHash);
    expect(JSON.parse(plaintext.toString('utf8')).participantId).toBe('12345678');
  });

  it('refuses on a keyless deployment instead of writing plaintext evidence', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    expect(() => consentEvidence.storeConsentEvidence(input)).toThrow(/ENCRYPTION_KEY/);
    expect(written).toBeNull();
  });

  // RF010 AC4/AC6: a revocation's evidence, stored the same way, binds its
  // scope and signer, and returns what decrypts it.
  it('stores a revocation\'s evidence encrypted beside the acceptance', () => {
    const key = Buffer.alloc(32, 9);
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(key);
    vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k2');
    vi.spyOn(keyRegistry, 'getKeyById').mockReturnValue(key);

    const result = consentEvidence.storeRevocationEvidence({
      consentId: input.consentId,
      consentRevocationId: 'rev-1',
      participantId: '12345678',
      scope: ['contact'],
      reason: null,
      priorUseDisposition: 'retain_history',
      effectiveAt: new Date('2026-10-08T12:00:00Z'),
      channel: 'staff_portal',
      signerRole: 'staff_on_behalf',
      signerId: 'user-1',
    });

    expect(result.evidenceUri).toBe(`objstore://consents/${input.consentId}/revocation-rev-1.json`);
    expect(result.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    const plaintext = fileCrypto.decryptFileBuffer(written.data, {
      encryptionKeyId: 'k2',
      encryptionIv: result.evidenceEncryption.iv,
      encryptionTag: result.evidenceEncryption.tag,
    });
    expect(`sha256:${fileCrypto.computeChecksum(plaintext)}`).toBe(result.evidenceHash);
    expect(JSON.parse(plaintext.toString('utf8'))).toMatchObject({
      consentRevocationId: 'rev-1', scope: ['contact'], signerRole: 'staff_on_behalf', effectiveAt: '2026-10-08T12:00:00.000Z',
    });
  });
});
