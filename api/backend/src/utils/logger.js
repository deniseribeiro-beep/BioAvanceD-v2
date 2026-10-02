/**
 * Logger utilitário para o sistema
 *
 * #1260: the minimum level comes from security_config's logging.level, held
 * in ./logLevel. Errors always print (see logLevel.js for 'critical').
 */

const { isEnabled } = require('./logLevel');

const log = {
  info: (message, ...args) => {
    if (!isEnabled('info')) return;
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
  },

  error: (message, ...args) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
  },

  warn: (message, ...args) => {
    // #1274: a warning tagged [SECURITY] prints at any level, as errors do.
    // It is a security event, and OWASP's logging guidance (Logging Cheat
    // Sheet; ASVS V7) requires those logged, so an operator quietening the
    // log must not silence an unencrypted write or a blocked source.
    const security = typeof message === 'string' && message.startsWith('[SECURITY]');
    if (!security && !isEnabled('warn')) return;
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
  },

  debug: (message, ...args) => {
    // The config vocabulary starts at 'info', so debug follows it.
    if (process.env.NODE_ENV === 'development' && isEnabled('info')) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
};

module.exports = log;
