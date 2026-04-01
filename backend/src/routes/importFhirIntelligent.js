// backend/src/routes/importFhirIntelligent.js
const express = require('express');
const router = express.Router();
const { getNeo4jDriver } = require('../database/neo4j');
const PatientModel = require('../models/Patient');
const SampleModel = require('../models/Sample');
const ObservationModel = require('../models/Observation');
const auditService = require('../services/auditRoot.service');
const logger = require('../utils/logger');

const ORPHA_SYSTEM = 'http://www.orpha.net';
const HPO_SYSTEM = 'http://purl.obolibrary.org/obo/hp.owl';

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isValidCoding(coding, expectedSystem) {
  if (!coding || typeof coding !== 'object') return false;
  if (expectedSystem && String(coding.system || '').trim() !== expectedSystem) return false;
  return Boolean(
    String(coding.system || '').trim()
    && String(coding.code || '').trim()
    && String(coding.display || '').trim()
  );
}

function collectSemanticContractViolations(bundle) {
  const violations = [];

  (bundle.entry || []).forEach((entry, index) => {
    const resource = entry?.resource;
    if (!resource) return;

    if (resource.resourceType === 'Specimen') {
      const codings = Array.isArray(resource?.type?.coding) ? resource.type.coding : [];
      const orphaCodings = codings.filter((coding) => String(coding?.system || '').trim() === ORPHA_SYSTEM);

      if (orphaCodings.length === 0) {
        violations.push({
          type: 'missing_orpha_coding',
          resourceType: 'Specimen',
          resourceId: resource.id || null,
          entryIndex: index,
          message: 'Specimen sem coding ORPHA estruturado em type.coding.',
        });
      } else {
        orphaCodings.forEach((coding) => {
          if (!isValidCoding(coding, ORPHA_SYSTEM)) {
            violations.push({
              type: 'invalid_orpha_coding',
              resourceType: 'Specimen',
              resourceId: resource.id || null,
              entryIndex: index,
              message: 'Coding ORPHA invalido. Esperado: { system, code, display }.',
            });
          }
        });
      }
    }

    if (resource.resourceType === 'Observation') {
      const codings = Array.isArray(resource?.code?.coding) ? resource.code.coding : [];
      const hpoCodings = codings.filter((coding) => String(coding?.system || '').trim() === HPO_SYSTEM);

      hpoCodings.forEach((coding) => {
        if (!isValidCoding(coding, HPO_SYSTEM)) {
          violations.push({
            type: 'invalid_hpo_coding',
            resourceType: 'Observation',
            resourceId: resource.id || null,
            entryIndex: index,
            message: 'Coding HPO invalido. Esperado: { system, code, display }.',
          });
        }
      });
    }
  });

  return violations;
}

// Utilitário: mapeia coding ORPHA/HPO para Neo4j/MongoDB
async function mapCodingToNodes(coding, neo4jSession) {
  if (!coding || !coding.system || !coding.code) return null;
  if (coding.system === 'http://www.orpha.net') {
    // Busca/Cria nó ORPHA no Neo4j
    const result = await neo4jSession.run(
      'MERGE (d:Doenca_ORPHA {code: $code}) RETURN d',
      { code: coding.code }
    );
    return result.records[0]?.get('d').properties || null;
  }
  // Adicione outros sistemas conforme necessário
  return null;
}

// Parser FHIR inteligente
router.post('/fhir-intelligent', async (req, res) => {
  const bundle = req.body;
  if (!bundle || bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
    return res.status(400).json({ error: 'Bundle FHIR inválido' });
  }

  const strictSemanticContract = isTruthyEnv(process.env.FHIR_SEMANTIC_STRICT);
  const semanticViolations = collectSemanticContractViolations(bundle);

  if (semanticViolations.length > 0) {
    const semanticSummary = {
      strictMode: strictSemanticContract,
      violations: semanticViolations,
    };

    if (strictSemanticContract) {
      return res.status(422).json({
        error: 'Bundle FHIR rejeitado por violacao do contrato semantico (ORPHA/HPO).',
        semanticContract: semanticSummary,
      });
    }

    logger.warn('[FHIR_IMPORT_SEMANTIC_WARNING] Bundle com violacoes semanticas em modo compatibilidade.', semanticSummary);
  }

  const neo4jDriver = getNeo4jDriver();
  const session = neo4jDriver.session();
  const auditLogs = [];
  try {
    for (const entry of bundle.entry) {
      const resource = entry.resource;
      if (!resource) continue;
      // Patient
      if (resource.resourceType === 'Patient') {
        await PatientModel.findOneAndUpdate(
          { patientID: resource.id },
          { $set: { patientName: resource.name?.[0]?.text || '', fhir: resource } },
          { upsert: true }
        );
        auditLogs.push({ type: 'Patient', id: resource.id, source: 'FHIR', action: 'import' });
      }
      // Specimen
      if (resource.resourceType === 'Specimen') {
        // Mapeia codings para ORPHA/HPO
        let orphaNode = null;
        if (resource.type?.coding) {
          for (const coding of resource.type.coding) {
            const mapped = await mapCodingToNodes(coding, session);
            if (mapped) orphaNode = mapped;
          }
        }
        await SampleModel.findOneAndUpdate(
          { sampleID: resource.id },
          { $set: { patientID: resource.subject?.reference?.replace('Patient/', ''), fhir: resource, orpha: orphaNode } },
          { upsert: true }
        );
        auditLogs.push({ type: 'Specimen', id: resource.id, source: 'FHIR', action: 'import' });
      }
      // Observation
      if (resource.resourceType === 'Observation') {
        await ObservationModel.findOneAndUpdate(
          { observationID: resource.id },
          { $set: { sampleID: resource.subject?.reference?.replace('Specimen/', ''), fhir: resource } },
          { upsert: true }
        );
        auditLogs.push({ type: 'Observation', id: resource.id, source: 'FHIR', action: 'import' });
      }
    }
    // Trilha de auditoria
    for (const log of auditLogs) {
      await auditService.log({
        entity: log.type,
        entityId: log.id,
        action: log.action,
        source: log.source,
        message: `Importação FHIR (${log.type})`,
        external: true
      });
    }

    res.json({
      success: true,
      imported: auditLogs.length,
      semanticContract: {
        strictMode: strictSemanticContract,
        warnings: strictSemanticContract ? [] : semanticViolations,
      },
    });
  } catch (err) {
    logger.error('[FHIR_IMPORT_ERROR]', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
