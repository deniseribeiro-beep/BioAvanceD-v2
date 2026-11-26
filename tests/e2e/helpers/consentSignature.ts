/**
 * #1544: a consent's signatureImageBase64 must decode to a real PNG, since the
 * signed TCLE PDF embeds it (decodePng in api/backend/src/services/tclePdf.js
 * throws "Assinatura não é um PNG" on any other payload, and the consent POST
 * answers 4xx). A 1x1 PNG as a data URL; normalizeSignaturePayload
 * (consent.service.js) reads its image/png MIME type from the prefix.
 */
export const SIGNATURE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
