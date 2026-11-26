/**
 * ICP-Brasil helpers for remote TCLE qualified signature evidence (ADR 2026-11-26).
 * Homolog accepts a client-supplied thumbprint + signed term hash; production
 * should verify the CMS/PKCS#7 against the ITI trust chain before accepting.
 */
function isIcpBrasilEnabled() {
  return String(process.env.CONSENT_ICP_BRASIL_ENABLED || '').toLowerCase() === 'true';
}

function normalizeIcpProof(input) {
  if (!input || typeof input !== 'object') return null;
  const thumbprint = String(input.certificateThumbprint || input.thumbprint || '').trim();
  if (!thumbprint) return null;
  return {
    provider: 'icp-brasil',
    certificateThumbprint: thumbprint,
    signedTermHash: input.signedTermHash ? String(input.signedTermHash) : null,
    subjectDn: input.subjectDn ? String(input.subjectDn) : null,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Validate shape. Full cryptographic verification is gated behind
 * CONSENT_ICP_BRASIL_VERIFY=true and requires a CMS buffer (future).
 */
function acceptIcpIdentityProof(input) {
  if (!isIcpBrasilEnabled()) {
    const err = new Error('Assinatura ICP-Brasil desabilitada');
    err.statusCode = 503;
    throw err;
  }
  const proof = normalizeIcpProof(input);
  if (!proof) {
    const err = new Error('certificateThumbprint obrigatório para ICP-Brasil');
    err.statusCode = 400;
    throw err;
  }
  return proof;
}

module.exports = {
  isIcpBrasilEnabled,
  normalizeIcpProof,
  acceptIcpIdentityProof,
};
