const TYPE_TAGS = Object.freeze({
  null: 'null',
  boolean: 'bool',
  number: 'num',
  string: 'str',
  array: 'arr',
  object: 'obj',
});

function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';
}

function assertJsonValue(value) {
  if (value === null) return;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON canônico rejeita NaN e Infinity');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertJsonValue);
    return;
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach(assertJsonValue);
    return;
  }
  throw new TypeError(`Tipo não suportado na canonicalização JSON: ${type}`);
}

function normalizeNumber(value) {
  if (Object.is(value, -0)) return 0;
  return value;
}

function canonicalize(value) {
  assertJsonValue(value);

  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(normalizeNumber(value)) : JSON.stringify(normalizeNumber(value));
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  throw new TypeError('Valor não suportado');
}

function digestCanonical(value, hashAlgorithm = 'sha256') {
  const crypto = require('crypto');
  const canonical = canonicalize(value);
  const hash = crypto.createHash(hashAlgorithm).update(Buffer.from(canonical, 'utf8')).digest('hex');
  return { canonical, hash };
}

module.exports = {
  TYPE_TAGS,
  canonicalize,
  digestCanonical,
  isPlainObject,
};
