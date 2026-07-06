const crypto = require('crypto');

const KEY_BYTES = 32;

function deriveKey(rawKey) {
  const normalized = String(rawKey || '').trim();
  if (!normalized) return null;
  const hash = crypto.createHash('sha256').update(normalized).digest();
  return hash.subarray(0, KEY_BYTES);
}

function getActiveKeyId() {
  return String(process.env.ENCRYPTION_KEY_ID || 'default').trim();
}

function getKeyEntries() {
  const entries = [];

  const activeKey = deriveKey(process.env.ENCRYPTION_KEY);
  const activeKeyId = getActiveKeyId();
  if (activeKey) {
    entries.push({ keyId: activeKeyId, key: activeKey, isActive: true });
  }

  // Suporte a chave legada removido

  return entries;
}

function getActiveKey() {
  const active = getKeyEntries().find((entry) => entry.isActive);
  return active ? active.key : null;
}

function getKeyById(keyId) {
  if (!keyId) return null;
  const normalized = String(keyId).trim();
  const entry = getKeyEntries().find((item) => item.keyId === normalized);
  return entry ? entry.key : null;
}

function getFallbackKeys() {
  const entries = getKeyEntries();
  const seen = new Set();
  const keys = [];

  for (const entry of entries) {
    const hash = entry.key.toString('hex');
    if (!seen.has(hash)) {
      seen.add(hash);
      keys.push(entry.key);
    }
  }

  return keys;
}

module.exports = {
  getActiveKeyId,
  getActiveKey,
  getKeyById,
  getFallbackKeys,
  getKeyEntries
};
