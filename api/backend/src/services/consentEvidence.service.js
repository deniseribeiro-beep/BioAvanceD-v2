const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STORAGE_BASE } = require('../config/uploadConfig');
const {
  assertFileEncryptionConfigured,
  encryptFileBuffer,
  computeChecksum,
} = require('../utils/fileCrypto');

/**
 * #827 -- RF010 AC#4 ("Registrar data, evidência, hash, origem e
 * signatário") and dict-02's Consent evidence trio, all 1..1 Core:
 * ELM-0105 evidenceDocumentUri ("URI do termo assinado ou evidência
 * equivalente", Criptografado), ELM-0106 evidenceHash (SHA-256) and
 * P1X-0373 evidenceMimeType.
 *
 * No manifestation path produces a signed PDF, so the evidence is the
 * "equivalente": one JSON document binding the exact term text the
 * participant was shown (by its own SHA-256) to their answers, the time
 * and origin of the decision and the signature hash when there is one.
 * It is stored through RF007's object-storage path (objstore:// URI,
 * AES-256-GCM at rest, checksum over the plaintext) rather than a second
 * implementation, and fails closed on a keyless deployment for the same
 * reason uploads do (#938).
 */
const EVIDENCE_MIME_TYPE = 'application/json';
const EVIDENCE_FILE_NAME = 'evidence.json';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function buildConsentEvidenceDocument({ consentId, participantId, template, responses, decisionDateTime, signatureHash, signerRole, ipAddress, userAgent }) {
  const termText = template.htmlContent || template.content || '';
  return {
    evidenceSchema: 'bioavanced.consent-evidence/v1',
    consentId,
    participantId,
    consentTemplateId: String(template._id),
    consentVersion: template.version != null ? String(template.version) : null,
    versionGroupId: template.versionGroupId || null,
    termTitle: template.title || null,
    termContentHash: `sha256:${sha256Hex(termText)}`,
    responses: responses || {},
    decisionDateTime: new Date(decisionDateTime).toISOString(),
    signerRole: signerRole || 'participant',
    signatureHash: signatureHash || null,
    origin: {
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    },
  };
}

function storeConsentEvidence(input) {
  assertFileEncryptionConfigured();

  const document = buildConsentEvidenceDocument(input);
  const plaintext = Buffer.from(JSON.stringify(document), 'utf8');
  const checksum = computeChecksum(plaintext);
  const encryption = encryptFileBuffer(plaintext);

  const dir = path.join(STORAGE_BASE, 'consents', String(input.consentId));
  fs.mkdirSync(dir, { recursive: true });
  const storagePath = path.join(dir, EVIDENCE_FILE_NAME);
  fs.writeFileSync(storagePath, encryption ? encryption.ciphertext : plaintext);

  return {
    evidenceDocumentUri: `objstore://consents/${input.consentId}/${EVIDENCE_FILE_NAME}`,
    evidenceHash: `sha256:${checksum}`,
    evidenceMimeType: EVIDENCE_MIME_TYPE,
    evidenceEncryption: encryption
      ? {
          algorithm: encryption.algorithm,
          keyId: encryption.keyId,
          iv: encryption.iv,
          tag: encryption.tag,
        }
      : null,
  };
}

/**
 * RF010 AC4/AC6: a revocation's own evidence, the document its
 * ConsentDecisionEvent's evidenceUri/evidenceHash (V2E-0129/0130) name. It
 * binds the scope, prospective effect, prior-use disposition and signer,
 * stored beside the consent's acceptance evidence through the same path.
 */
function storeRevocationEvidence(input) {
  assertFileEncryptionConfigured();

  const document = {
    evidenceSchema: 'bioavanced.consent-revocation-evidence/v1',
    consentId: input.consentId,
    consentRevocationId: input.consentRevocationId,
    participantId: input.participantId || null,
    scope: input.scope,
    reason: input.reason || null,
    priorUseDisposition: input.priorUseDisposition,
    effectiveAt: new Date(input.effectiveAt).toISOString(),
    channel: input.channel,
    signerRole: input.signerRole,
    signerId: input.signerId,
  };
  const plaintext = Buffer.from(JSON.stringify(document), 'utf8');
  const checksum = computeChecksum(plaintext);
  const encryption = encryptFileBuffer(plaintext);

  const fileName = `revocation-${input.consentRevocationId}.json`;
  const dir = path.join(STORAGE_BASE, 'consents', String(input.consentId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), encryption ? encryption.ciphertext : plaintext);

  return {
    evidenceUri: `objstore://consents/${input.consentId}/${fileName}`,
    evidenceHash: `sha256:${checksum}`,
    evidenceEncryption: encryption
      ? {
          algorithm: encryption.algorithm,
          keyId: encryption.keyId,
          iv: encryption.iv,
          tag: encryption.tag,
        }
      : null,
  };
}

module.exports = {
  EVIDENCE_MIME_TYPE,
  buildConsentEvidenceDocument,
  storeConsentEvidence,
  storeRevocationEvidence,
};
