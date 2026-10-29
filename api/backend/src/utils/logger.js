/**
 * Logger utilitário para o sistema
 *
 * #1260: the minimum level comes from security_config's logging.level, held
 * in ./logLevel. Errors always print (see logLevel.js for 'critical').
 *
 * #1308 (RNF007 C5, RNF020 C6): every message and argument passes through
 * logRedaction.redact before it prints, and a line written while a request is
 * being served carries that request's id (requestContext.js).
 */

const { isEnabled } = require('./logLevel');
const { redact } = require('./logRedaction');
const { currentRequestId } = require('./requestContext');

function render(level, message, args) {
  const requestId = currentRequestId();
  const head = `[${level}] ${new Date().toISOString()}${requestId ? ` [req:${requestId}]` : ''} - ${redact(message)}`;
  return [head, ...args.map((arg) => redact(arg))];
}

const log = {
  info: (message, ...args) => {
    if (!isEnabled('info')) return;
    console.log(...render('INFO', message, args));
  },

  error: (message, ...args) => {
    console.error(...render('ERROR', message, args));
  },

  warn: (message, ...args) => {
    // #1274: a warning tagged [SECURITY] prints at any level, as errors do.
    // It is a security event, and OWASP's logging guidance (Logging Cheat
    // Sheet; ASVS V7) requires those logged, so an operator quietening the
    // log must not silence an unencrypted write or a blocked source.
    const security = typeof message === 'string' && message.startsWith('[SECURITY]');
    if (!security && !isEnabled('warn')) return;
    console.warn(...render('WARN', message, args));
  },

  debug: (message, ...args) => {
    // The config vocabulary starts at 'info', so debug follows it.
    if (process.env.NODE_ENV === 'development' && isEnabled('info')) {
      console.log(...render('DEBUG', message, args));
    }
  }
};

module.exports = log;
