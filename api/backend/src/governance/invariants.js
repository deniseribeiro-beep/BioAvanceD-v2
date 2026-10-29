/**
 * The governance invariants no configuration may override (RF014 AC6,
 * RNF023 C7, RNF028 C5, CFG-003), published as the GovernanceInvariantCatalog
 * the Foundation job registers. A change to this list is a new catalog
 * version, so `INVARIANT_CATALOG_VERSION` moves with it.
 *
 * `configurationPaths` is not a dictionary field: it is how the
 * ConfigurationValidationRun finds the settings an invariant fixes. An
 * invariant with no path is held by the structural gate instead, which
 * refuses any key outside the profile's catalog (CFG-002: "Configuração não
 * cria campos canônicos ou entidades fora da release aprovada").
 */
const INVARIANT_CATALOG_VERSION = '1.0.0';

const CHANGE_PROCEDURE = 'Somente por nova CanonicalModelRelease aprovada e novo GovernanceInvariantCatalog; nenhuma ConfigurationRelease altera este invariante.';
const VALIDATION_TEST = 'api/backend/tests/unit/services/configurationValidation.service.test.js';
const FIXED_KEYS_TEST = 'api/backend/tests/unit/security.service.fixedKeys.1260.test.js';
const VALIDATION_POINT = 'api/backend/src/services/configurationValidation.service.js';
const SECURITY_POINT = 'api/backend/src/services/security.service.js#FIXED_PATHS';

const INVARIANTS = [
  {
    invariantId: 'INV-AUDIT-001',
    statement: 'A trilha de auditoria registra toda ação e toda tentativa de login; nenhuma configuração a desliga (RF009, RF014 AC6, RNF028 C5).',
    enforcementPoint: [SECURITY_POINT, VALIDATION_POINT],
    testId: [VALIDATION_TEST, FIXED_KEYS_TEST],
    violationOutcome: 'block',
    changeProcedure: CHANGE_PROCEDURE,
    configurationPaths: ['logging.logLoginAttempts', 'logging.logAllActions', 'enhancedSecurity.logAllActions'],
  },
  {
    invariantId: 'INV-PRIVACY-001',
    statement: 'Logs são sempre pseudonimizados; nenhuma configuração grava identidade em log (RNF007, RNF028 C5).',
    enforcementPoint: [SECURITY_POINT, VALIDATION_POINT],
    testId: [VALIDATION_TEST, FIXED_KEYS_TEST],
    violationOutcome: 'block',
    changeProcedure: CHANGE_PROCEDURE,
    configurationPaths: ['privacy.anonymizeLogs'],
  },
  {
    invariantId: 'INV-CONSENT-001',
    statement: 'Coleta e uso exigem consentimento válido; nenhuma configuração dispensa o consentimento (RF014 AC6, RNF028 C5).',
    enforcementPoint: [SECURITY_POINT, VALIDATION_POINT],
    testId: [VALIDATION_TEST, FIXED_KEYS_TEST],
    violationOutcome: 'block',
    changeProcedure: CHANGE_PROCEDURE,
    configurationPaths: ['lgpd.requireConsent'],
  },
  {
    invariantId: 'INV-IDENTITY-001',
    statement: 'Exportações carregam somente o participantId pseudonimizado; a identidade canônica não sai da fronteira de identidade por configuração (RF003, RF014 AC6).',
    enforcementPoint: [SECURITY_POINT, VALIDATION_POINT],
    testId: [VALIDATION_TEST, FIXED_KEYS_TEST],
    violationOutcome: 'block',
    changeProcedure: CHANGE_PROCEDURE,
    configurationPaths: ['lgpd.anonymizeOnExport'],
  },
  {
    invariantId: 'INV-SCOPE-001',
    statement: 'Configuração não cria chave fora do catálogo do perfil; autoridade dos stores, outbox, fronteira FHIR, finalidade, proveniência e admissibilidade do RCS não são configuráveis (RF014 AC6, RNF028 C5/C7, CFG-002).',
    enforcementPoint: [VALIDATION_POINT],
    testId: [VALIDATION_TEST],
    violationOutcome: 'block',
    changeProcedure: CHANGE_PROCEDURE,
    configurationPaths: [],
  },
];

/** The invariant that fixes `path`, or null. */
function invariantForPath(path) {
  return INVARIANTS.find((invariant) => invariant.configurationPaths.includes(path)) || null;
}

module.exports = {
  INVARIANT_CATALOG_VERSION,
  INVARIANTS,
  invariantForPath,
};
