const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STORAGE_BASE } = require('../config/uploadConfig');
const {
  assertFileEncryptionConfigured,
  encryptFileBuffer,
  decryptFileBuffer,
  computeChecksum,
} = require('../utils/fileCrypto');
const { buildSignedTclePdf } = require('./tclePdf');

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

function normalizeIdentityProof(identityProof) {
  if (!identityProof || typeof identityProof !== 'object') return null;
  const provider = String(identityProof.provider || '').toLowerCase();
  if (provider === 'govbr') {
    return {
      identityProvider: 'govbr',
      govbrSub: identityProof.sub ? String(identityProof.sub) : null,
      email: identityProof.email || null,
      name: identityProof.name || null,
      mock: Boolean(identityProof.mock),
      verifiedAt: identityProof.verifiedAt || null,
    };
  }
  if (provider === 'icp-brasil' || provider === 'icp_brasil') {
    return {
      identityProvider: 'icp-brasil',
      certificateThumbprint: identityProof.certificateThumbprint
        ? String(identityProof.certificateThumbprint)
        : null,
      signedTermHash: identityProof.signedTermHash ? String(identityProof.signedTermHash) : null,
      subjectDn: identityProof.subjectDn || null,
      verifiedAt: identityProof.verifiedAt || null,
    };
  }
  if (provider === 'panel') {
    return { identityProvider: 'panel' };
  }
  return null;
}

function buildConsentEvidenceDocument({
  consentId,
  participantId,
  template,
  responses,
  decisionDateTime,
  signatureHash,
  signerRole,
  ipAddress,
  userAgent,
  collectionPlace,
  location,
  identityProof,
}) {
  const termText = template.htmlContent || template.content || '';
  const place = typeof collectionPlace === 'string' ? collectionPlace.trim() : '';
  const origin = {
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  };
  if (place) origin.collectionPlace = place;
  if (location && typeof location === 'object') origin.location = location;
  const identity = normalizeIdentityProof(identityProof) || { identityProvider: 'panel' };
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
    identity,
    origin,
  };
}

function storeEncryptedConsentFile(consentId, fileName, plaintext) {
  assertFileEncryptionConfigured();
  const checksum = computeChecksum(plaintext);
  const encryption = encryptFileBuffer(plaintext);
  const dir = path.join(STORAGE_BASE, 'consents', String(consentId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), encryption ? encryption.ciphertext : plaintext);
  return {
    uri: `objstore://consents/${consentId}/${fileName}`,
    hash: `sha256:${checksum}`,
    encryption: encryption
      ? {
          algorithm: encryption.algorithm,
          keyId: encryption.keyId,
          iv: encryption.iv,
          tag: encryption.tag,
        }
      : null,
  };
}

const SIGNED_TCLE_FILE_NAME = 'tcle.pdf';

function storeConsentEvidence(input) {
  const document = buildConsentEvidenceDocument(input);
  const signed = input.signatureImageBase64
    ? storeEncryptedConsentFile(
        input.consentId,
        SIGNED_TCLE_FILE_NAME,
        buildSignedTclePdf({
          template: input.template,
          collectionPlace: document.origin.collectionPlace || null,
          decisionDateTime: document.decisionDateTime,
          signatureImageBase64: input.signatureImageBase64,
        })
      )
    : null;

  const stored = storeEncryptedConsentFile(
    input.consentId,
    EVIDENCE_FILE_NAME,
    Buffer.from(JSON.stringify(document), 'utf8')
  );

  return {
    evidenceDocumentUri: stored.uri,
    evidenceHash: stored.hash,
    evidenceMimeType: EVIDENCE_MIME_TYPE,
    evidenceEncryption: stored.encryption,
    signedTcleDocumentUri: signed ? signed.uri : null,
    signedTcleHash: signed ? signed.hash : null,
    signedTcleEncryption: signed ? signed.encryption : null,
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
    location: input.location || { status: 'unavailable' },
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

function readSignedTcle(consent) {
  const uri = consent?.signedTcleDocumentUri;
  const match = typeof uri === 'string' ? /^objstore:\/\/consents\/([^/]+)\/([^/]+)$/.exec(uri) : null;
  if (!match) return null;

  const filePath = path.join(STORAGE_BASE, 'consents', match[1], match[2]);
  if (!fs.existsSync(filePath)) return null;

  const stored = fs.readFileSync(filePath);
  const envelope = consent.signedTcleEncryption;
  const plaintext = envelope
    ? decryptFileBuffer(stored, {
        encryptionKeyId: envelope.keyId,
        encryptionIv: envelope.iv,
        encryptionTag: envelope.tag,
      })
    : stored;

  const expected = String(consent.signedTcleHash || '').replace(/^sha256:/, '');
  if (expected && computeChecksum(plaintext) !== expected) {
    const error = new Error('Hash do TCLE assinado não confere');
    error.statusCode = 409;
    throw error;
  }
  return plaintext;
}

module.exports = {
  EVIDENCE_MIME_TYPE,
  buildConsentEvidenceDocument,
  storeConsentEvidence,
  storeRevocationEvidence,
  readSignedTcle,
};
