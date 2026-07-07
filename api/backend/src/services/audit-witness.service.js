const crypto = require('crypto');
const env = require('../config/env');

class AuditExternalWitnessService {
  async publish(record) {
    const witnessUrl = String(env.AUDIT_EXTERNAL_WITNESS_URL || '').trim();
    if (!witnessUrl) return { status: 'UNAVAILABLE', reason: 'missing_witness_url' };
    const payload = JSON.stringify(record);
    const response = await fetch(witnessUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    if (!response.ok) return { status: 'FAILED', reason: `witness_http_${response.status}` };
    const body = await response.json();
    return { status: 'WITNESSED', receipt: body.receipt || null, witnessId: body.witnessId || null, body };
  }

  digest(record) {
    return crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
  }
}

module.exports = new AuditExternalWitnessService();
