/**
 * Log redaction (#1308; RNF007 C5, RNF020 C6, RF012 AC7): every value the
 * logger prints passes through redact() first, so a secret or a direct
 * identifier handed to logger.* by any call site does not reach stdout.
 *
 * Two layers:
 * - an object field whose NAME is sensitive is replaced whole, whatever its
 *   value (a password, a token, a CPF, an e-mail);
 * - inside every string, shapes that are sensitive on sight are masked: a
 *   JWT, a Bearer credential, credentials in a connection URI, a
 *   `password=...` style pair, a formatted CPF and an e-mail address.
 *
 * Pseudonyms (USR-XXXXXXXX), ids and hashes pass, since they are what the
 * logs are for.
 */

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

const SENSITIVE_KEY = /pass(word|wd)?$|^senha|secret|token$|^token|authorization|cookie|api[-_]?key|private[-_]?key|^cpf$|^rg$|e-?mail|phone|telefone|celular|birth|nascimento|^otp|totp|mfaSecret|recoveryCode/i;

const STRING_RULES = [
  // A JWT: three base64url segments, the first a JSON header.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]'],
  // scheme://user:password@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, '$1[REDACTED]@'],
  [/\b(password|passwd|senha|secret|token|api[_-]?key)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, `$1$2${REDACTED}`],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[REDACTED_CPF]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
];

function redactString(value) {
  let out = value;
  for (const [pattern, replacement] of STRING_RULES) out = out.replace(pattern, replacement);
  return out;
}

function redact(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Object]';
  seen.add(value);

  if (value instanceof Error) {
    const copy = new Error(redactString(String(value.message || '')));
    copy.name = value.name;
    if (value.code !== undefined) copy.code = value.code;
    copy.stack = value.stack ? redactString(String(value.stack)) : copy.stack;
    return copy;
  }
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) && item !== null && item !== undefined && item !== ''
      ? REDACTED
      : redact(item, depth + 1, seen);
  }
  return out;
}

module.exports = { redact, redactString, SENSITIVE_KEY, REDACTED };
