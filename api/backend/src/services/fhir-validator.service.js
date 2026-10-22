const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const logger = require('../utils/logger');
const FHIRProfileRegistryModel = require('../models/FHIRProfileRegistry');
const IdentifierNamespaceRegistryModel = require('../models/IdentifierNamespaceRegistry');
const { FHIR_VERSIONS } = require('../models/InteroperabilityMappingRelease');
const conformanceRegistry = require('../resources/fhir/conformance-registry');

const PROFILES_DIR = path.join(__dirname, '../resources/fhir/profiles');
const REQUIRED_RESOURCE_TYPES = ['Patient', 'Specimen', 'Observation', 'Organization', 'Bundle'];
// RF011 AC1: a declared profile counts only through a row at one of these.
const ELIGIBLE_PROFILE_STATUSES = ['approved', 'active'];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const pointer = (segments) => `/${segments.map((s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

class FhirValidatorService {
  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
    this.schemaMap = new Map();
    this.loaded = false;
    this.loadSchemas();
  }

  loadSchemas() {
    if (!fs.existsSync(PROFILES_DIR)) {
      logger.warn('Pasta de perfis FHIR não encontrada:', PROFILES_DIR);
      return;
    }

    const files = fs.readdirSync(PROFILES_DIR).filter((file) => file.endsWith('.json'));
    files.forEach((file) => {
      try {
        const fullPath = path.join(PROFILES_DIR, file);
        const raw = fs.readFileSync(fullPath, 'utf8');
        const schema = JSON.parse(raw);
        if (!schema.$id) {
          logger.warn(`Schema sem $id ignorado: ${file}`);
          return;
        }
        this.ajv.addSchema(schema, schema.$id);
        const resourceType = file.replace('.schema.json', '').replace('.json', '');
        this.schemaMap.set(resourceType, schema.$id);
      } catch (error) {
        logger.error(`Erro ao carregar schema FHIR ${file}:`, error.message);
      }
    });

    this.loaded = true;
  }

  isFhirResource(payload) {
    if (!payload) return false;
    if (Array.isArray(payload)) {
      return payload.some((item) => item && item.resourceType);
    }
    return Boolean(payload.resourceType || payload.entry);
  }

  getSchemaId(resourceType) {
    return this.schemaMap.get(resourceType) || null;
  }

  validateResource(resource, { registry = conformanceRegistry, sets } = {}) {
    const resourceType = resource?.resourceType;
    if (!resourceType) {
      return this.buildInvalidIssue('resourceType ausente', '/resourceType');
    }

    const schemaId = this.getSchemaId(resourceType);
    if (!schemaId) {
      return this.buildInvalidIssue(`Schema não encontrado para ${resourceType}`, `/resourceType`);
    }

    const validator = this.ajv.getSchema(schemaId);
    if (!validator) {
      return this.buildInvalidIssue(`Validador não carregado para ${resourceType}`, `/resourceType`);
    }

    const valid = validator(resource);
    const issues = valid ? [] : (validator.errors || []).map((err) => {
      return {
        severity: 'error',
        code: 'invalid',
        diagnostics: this.friendlyMessageFromError(resourceType, err),
        expression: err.instancePath || err.schemaPath
      };
    });

    // RF011 AC1, RNF024 C1: version, profile and identifier systems are
    // reported with the schema issues, whether or not the schema passed.
    issues.push(...this.conformanceIssues(resource, sets || this.buildConformanceSets(registry)));

    return { valid: issues.length === 0, issues };
  }

  // The profile rows and namespace URIs a registry makes eligible now: a row
  // its model refuses is ignored, never a crash.
  buildConformanceSets(registry = conformanceRegistry) {
    const profiles = (registry.profiles || []).filter((row) => {
      return FHIRProfileRegistryModel.validate(row).isValid && ELIGIBLE_PROFILE_STATUSES.includes(row.status);
    });

    const now = new Date();
    const systems = new Set();
    (registry.namespaces || []).forEach((row) => {
      let fields;
      try {
        fields = IdentifierNamespaceRegistryModel.create(row, { approvedAuthorities: registry.approvedAuthorities || [] });
      } catch (error) {
        return;
      }
      const { start, end } = fields.effectivePeriod;
      if (now >= start && (!end || now < end)) systems.add(fields.systemUri);
    });

    return { profiles, systems };
  }

  conformanceIssues(obj, sets, { skipEntry = false } = {}) {
    if (!isPlainObject(obj)) return [];
    const issues = [];
    const refuse = (code, reason, diagnostics, expression) => {
      issues.push({ severity: 'error', code, reason, diagnostics, expression });
    };

    // An own fhirVersion must be a supported release; none is read as R4,
    // the release the loaded schemas encode.
    if (hasOwn(obj, 'fhirVersion') && !(typeof obj.fhirVersion === 'string' && FHIR_VERSIONS.includes(obj.fhirVersion))) {
      refuse(
        'not-supported',
        'fhir-version-unsupported',
        `Versão FHIR não suportada: ${obj.fhirVersion} (aceitas: ${FHIR_VERSIONS.join(', ')})`,
        '/fhirVersion'
      );
    }

    if (isPlainObject(obj.meta) && hasOwn(obj.meta, 'profile')) {
      const declared = obj.meta.profile;
      if (!Array.isArray(declared)) {
        refuse('not-supported', 'profile-not-registered', `Perfil FHIR não registrado: ${declared}`, '/meta/profile');
      } else {
        declared.forEach((entry, index) => {
          if (!this.profileRegistered(entry, sets.profiles)) {
            refuse('not-supported', 'profile-not-registered', `Perfil FHIR não registrado: ${entry}`, `/meta/profile/${index}`);
          }
        });
      }
    }

    this.identifierSystemIssues(obj, sets.systems, { skipEntry }).forEach(({ system, expression }) => {
      refuse('invalid', 'identifier-system-unknown', `identifier.system fora de namespace registrado: ${system}`, expression);
    });

    return issues;
  }

  // `url|version` matches a row's canonicalUrl and profileVersion; a bare
  // url matches its canonicalUrl.
  profileRegistered(entry, profiles) {
    if (!isNonEmptyString(entry)) return false;
    const bar = entry.indexOf('|');
    if (bar === -1) return profiles.some((row) => row.canonicalUrl === entry);
    const url = entry.slice(0, bar);
    const version = entry.slice(bar + 1);
    return profiles.some((row) => row.canonicalUrl === url && row.profileVersion === version);
  }

  // Every Identifier under a key `identifier` or `*Identifier`, single or in
  // an array, at any depth, walked with an explicit stack so a deep payload
  // cannot overflow. An Identifier with no system is accepted (0..1);
  // `skipEntry` leaves a Bundle's entries to their own check.
  identifierSystemIssues(root, systems, { skipEntry = false } = {}) {
    const found = [];
    const stack = [{ value: root, path: [] }];
    while (stack.length) {
      const { value, path } = stack.pop();
      if (value === null || typeof value !== 'object') continue;

      const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
      keys.forEach((key) => {
        if (skipEntry && path.length === 0 && key === 'entry') return;
        const child = value[key];
        const childPath = [...path, key];

        if (typeof key === 'string' && (key === 'identifier' || key.endsWith('Identifier'))) {
          const identifiers = Array.isArray(child)
            ? child.map((item, i) => ({ item, at: [...childPath, i] }))
            : [{ item: child, at: childPath }];
          identifiers.forEach(({ item, at }) => {
            if (!isPlainObject(item) || !hasOwn(item, 'system')) return;
            if (!(isNonEmptyString(item.system) && systems.has(item.system))) {
              found.push({ system: item.system, expression: pointer([...at, 'system']) });
            }
          });
        }

        stack.push({ value: child, path: childPath });
      });
    }
    return found;
  }

  buildInvalidIssue(message, expression) {
    return {
      valid: false,
      issues: [
        {
          severity: 'error',
          code: 'invalid',
          diagnostics: message,
          expression
        }
      ]
    };
  }

  friendlyMessageFromError(resourceType, error) {
    const path = error.keyword === 'required'
      ? `${error.instancePath || ''}/${error.params?.missingProperty}`
      : error.instancePath || '';
    if (resourceType === 'Patient') {
      if (path.includes('/gender')) return "O campo 'Gênero' é inválido";
      if (path.includes('/birthDate')) return "O campo 'Data de Nascimento' é inválido";
      if (path.includes('/name')) return "O campo 'Nome' é inválido";
    }

    if (resourceType === 'Specimen') {
      if (path.includes('/subject')) return "O campo 'Paciente (subject)' é obrigatório";
      if (path.includes('/type')) return "O campo 'Tipo da amostra' é obrigatório";
    }

    if (resourceType === 'Observation') {
      if (path.includes('/status')) return "O campo 'Status' é inválido";
      if (path.includes('/code')) return "O campo 'Código da observação' é obrigatório";
    }

    if (resourceType === 'Organization') {
      if (path.includes('/name')) return "O campo 'Nome da organização' é obrigatório";
    }

    return error.message || 'Recurso FHIR inválido';
  }

  validatePayload(payload, allowedTypes = REQUIRED_RESOURCE_TYPES, { registry = conformanceRegistry } = {}) {
    const issues = [];
    let resourcesValidated = 0;
    const sets = this.buildConformanceSets(registry);

    const validateOne = (resource) => {
      if (!resource || !resource.resourceType) {
        issues.push({
          severity: 'error',
          code: 'invalid',
          diagnostics: 'resourceType ausente no recurso',
          expression: '/resourceType'
        });
        return;
      }

      if (!allowedTypes.includes(resource.resourceType)) {
        issues.push({
          severity: 'error',
          code: 'not-supported',
          diagnostics: `ResourceType ${resource.resourceType} não suportado neste escopo`,
          expression: '/resourceType'
        });
        return;
      }

      const result = this.validateResource(resource, { sets });
      if (!result.valid) {
        issues.push(...result.issues);
      }
      resourcesValidated += 1;
    };

    if (Array.isArray(payload)) {
      payload.forEach((resource) => validateOne(resource));
    } else if (payload.resourceType === 'Bundle' && Array.isArray(payload.entry)) {
      issues.push(...this.conformanceIssues(payload, sets, { skipEntry: true }));
      payload.entry.forEach((entry) => validateOne(entry.resource));
    } else {
      validateOne(payload);
    }

    return {
      valid: issues.length === 0,
      issues,
      resourcesValidated
    };
  }

  buildOperationOutcome(issues = []) {
    return {
      resourceType: 'OperationOutcome',
      issue: issues.map((issue) => ({
        severity: issue.severity || 'error',
        code: issue.code || 'invalid',
        diagnostics: issue.diagnostics,
        expression: issue.expression ? [issue.expression] : undefined
      }))
    };
  }
}

module.exports = new FhirValidatorService();
