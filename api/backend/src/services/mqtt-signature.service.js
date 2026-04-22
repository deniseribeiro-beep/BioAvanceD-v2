const crypto = require('crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

class MqttSignatureService {
  getSigningSecret() {
    const secret = String(process.env.MQTT_SIGNING_SECRET || '').trim();
    return secret || null;
  }

  hashPayload(rawPayload) {
    return sha256Hex(rawPayload || '');
  }

  computeHmac(rawPayload) {
    const secret = this.getSigningSecret();
    if (!secret) return null;
    return crypto.createHmac('sha256', secret).update(String(rawPayload || '')).digest('hex');
  }

  verifyHmac(rawPayload, signature) {
    const expected = this.computeHmac(rawPayload);
    if (!expected || !signature) return false;

    const expectedBuffer = Buffer.from(expected, 'hex');
    const signatureBuffer = Buffer.from(String(signature).trim(), 'hex');

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  }
}

module.exports = new MqttSignatureService();