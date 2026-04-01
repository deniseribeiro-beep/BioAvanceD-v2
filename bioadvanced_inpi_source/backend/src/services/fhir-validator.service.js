const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const logger = require('../utils/logger');

const PROFILES_DIR = path.join(__dirname, '../resources/fhir/profiles');
const REQUIRED_RESOURCE_TYPES = ['Patient', 'Specimen', 'Observation', 'Organization', 'Bundle'];

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

  validateResource(resource) {
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
    if (valid) {
      return { valid: true, issues: [] };
    }

    const issues = (validator.errors || []).map((err) => {
      return {
        severity: 'error',
        code: 'invalid',
        diagnostics: this.friendlyMessageFromError(resourceType, err),
        expression: err.instancePath || err.schemaPath
      };
    });

    return { valid: false, issues };
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
    const path = error.instancePath || '';
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

  validatePayload(payload, allowedTypes = REQUIRED_RESOURCE_TYPES) {
    const issues = [];
    let resourcesValidated = 0;

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

      const result = this.validateResource(resource);
      if (!result.valid) {
        issues.push(...result.issues);
      }
      resourcesValidated += 1;
    };

    if (Array.isArray(payload)) {
      payload.forEach((resource) => validateOne(resource));
    } else if (payload.resourceType === 'Bundle' && Array.isArray(payload.entry)) {
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
