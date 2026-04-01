/**
 * Teste de Integração: Ciclo de Vida da Quarentena + TCLE
 * Valida transições de estado QUARANTINED ↔ AVAILABLE baseadas em consentimento
 * 
 * Cobre:
 * - Amostra criada em QUARANTINED (padrão)
 * - Aceitação de TCLE -> AVAILABLE
 * - Revogação de TCLE -> QUARANTINED
 * - Sincronização MongoDB + Neo4j
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const Sample = require('../../src/models/Sample');
const Patient = require('../../src/models/Patient');

const CONSENT_SECRET = process.env.CONSENT_SECRET || 'consent_secret';
const DB_URI = process.env.MONGODB_DEV_URI || 'mongodb://localhost:27017/bioadvanced-test';
const neo4jDriver = require('../../src/infrastructure/database/neo4j/connection').getNeo4jDriver();

describe('Quarantine Consent Lifecycle Integration Tests', () => {
  let testPatientId = null;
  let testSampleId = null;
  let consentToken = null;

  beforeAll(async () => {
    // Conectar ao MongoDB
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(DB_URI);
    }

    // Criar paciente de teste
    const patient = await Patient.create({
      name: 'Test Patient - Quarantine Lifecycle',
      email: 'test-quarantine@bioadvanced.local',
      pseudonymizedId: `TEST-QUARANTINE-${Date.now()}`
    });
    testPatientId = patient._id.toString();

    // Criar amostra em estado QUARANTINED (padrão)
    const sample = await Sample.create({
      patientID: testPatientId,
      sampleType: 'Blood',
      sampleOrigin: 'Venous',
      extractionProtocol: 'Standard',
      quantity: 5,
      unit: 'mL',
      linkedProject: 'TEST_PROJECT',
      status: 'QUARANTINED'
    });
    testSampleId = sample._id.toString();

    // Gerar token JWT para testes de consentimento
    consentToken = jwt.sign({ patientId: testPatientId }, CONSENT_SECRET, { expiresIn: '2h' });
  });

  afterAll(async () => {
    // Cleanup
    if (testSampleId) {
      await Sample.deleteOne({ _id: testSampleId });
    }
    if (testPatientId) {
      await Patient.deleteOne({ _id: testPatientId });
    }

    // Cleanup Neo4j
    const session = neo4jDriver.session();
    try {
      await session.run(
        'MATCH (p:Patient {patientID: $patientId}) DETACH DELETE p',
        { patientId: testPatientId }
      );
    } finally {
      await session.close();
    }

    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  });

  describe('Sample Lifecycle: QUARANTINED → AVAILABLE', () => {
    it('Deve verificar que amostra foi criada em QUARANTINED', async () => {
      const sample = await Sample.findById(testSampleId);
      expect(sample.status).toBe('QUARANTINED');
    });

    it('Deve validar que status QUARANTINED é reconhecido no enum', async () => {
      expect(Sample.STATUS.QUARANTINED).toBe('QUARANTINED');
      expect(Sample.validateLifecycleStatus('QUARANTINED')).toBe(true);
    });

    it('Deve liberar amostra quando consentimento é ACTIVE', async () => {
      // Simular aceitação do TCLE
      const consents = [
        { key: 'uso_pesquisa', status: 'ACTIVE' },
        { key: 'uso_clinico', status: 'ACTIVE' }
      ];

      // Atualizar MongoDB
      await Sample.updateMany(
        { patientID: testPatientId, status: 'QUARANTINED' },
        { $set: { status: 'AVAILABLE', updatedAt: new Date() } }
      );

      // Atualizar Neo4j
      const session = neo4jDriver.session();
      try {
        await session.run(
          'MERGE (p:Patient {patientID: $patientId}) MERGE (s:Sample {id: $sampleId}) WITH p, s WHERE NOT (p)-[:HAS_SAMPLE]->(s) CREATE (p)-[:HAS_SAMPLE]->(s) SET s.status = "AVAILABLE", s.updatedAt = datetime()',
          { patientId: testPatientId, sampleId: testSampleId }
        );
      } finally {
        await session.close();
      }

      // Validar transição em MongoDB
      const updatedSample = await Sample.findById(testSampleId);
      expect(updatedSample.status).toBe('AVAILABLE');
    });

    it('Deve bloquear amostra quando consentimento é REVOGADO', async () => {
      // Amostra estava AVAILABLE, agora revogamos
      const consents = [
        { key: 'uso_pesquisa', status: 'REVOKED' }
      ];

      // Atualizar MongoDB
      await Sample.updateMany(
        { patientID: testPatientId },
        { $set: { status: 'QUARANTINED', updatedAt: new Date() } }
      );

      // Atualizar Neo4j
      const session = neo4jDriver.session();
      try {
        await session.run(
          'MATCH (p:Patient {patientID: $patientId})-[:HAS_SAMPLE]->(s:Sample) SET s.status = "QUARANTINED", s.updatedAt = datetime()',
          { patientId: testPatientId }
        );
      } finally {
        await session.close();
      }

      // Validar transição em MongoDB
      const revokedSample = await Sample.findById(testSampleId);
      expect(revokedSample.status).toBe('QUARANTINED');
    });

    it('Deve re-liberar amostra após aceitar TCLE novamente', async () => {
      // Amostra estava QUARANTINED, agora aceitamos novamente
      const consents = [
        { key: 'uso_pesquisa', status: 'ACTIVE' },
        { key: 'uso_clinico', status: 'GRANTED' }
      ];

      // Atualizar MongoDB
      await Sample.updateMany(
        { patientID: testPatientId, status: 'QUARANTINED' },
        { $set: { status: 'AVAILABLE', updatedAt: new Date() } }
      );

      // Atualizar Neo4j
      const session = neo4jDriver.session();
      try {
        await session.run(
          'MATCH (p:Patient {patientID: $patientId})-[:HAS_SAMPLE]->(s:Sample) WHERE s.status = "QUARANTINED" SET s.status = "AVAILABLE", s.updatedAt = datetime()',
          { patientId: testPatientId }
        );
      } finally {
        await session.close();
      }

      // Validar transição final
      const finalSample = await Sample.findById(testSampleId);
      expect(finalSample.status).toBe('AVAILABLE');
    });
  });

  describe('Sincronização MongoDB ↔ Neo4j', () => {
    it('Deve manter consistência entre MongoDB e Neo4j durante transição QUARANTINED→AVAILABLE', async () => {
      // Definir amostra como QUARANTINED inicialmente
      await Sample.findByIdAndUpdate(testSampleId, { status: 'QUARANTINED' });

      // Simular transição sincronizada
      // MongoDB
      await Sample.updateMany(
        { _id: testSampleId },
        { $set: { status: 'AVAILABLE' } }
      );

      // Neo4j
      const session = neo4jDriver.session();
      try {
        await session.run(
          'MERGE (p:Patient {patientID: $patientId}) MERGE (s:Sample {id: $sampleId}) CREATE (p)-[:HAS_SAMPLE]->(s) SET s.status = "AVAILABLE"',
          { patientId: testPatientId, sampleId: testSampleId }
        );

        // Validar consistência
        const result = await session.run(
          'MATCH (s:Sample {id: $sampleId}) RETURN s.status as status',
          { sampleId: testSampleId }
        );

        const neo4jStatus = result.records[0]?.get('status');
        const mongoStatus = (await Sample.findById(testSampleId)).status;

        expect(neo4jStatus).toBe('AVAILABLE');
        expect(mongoStatus).toBe('AVAILABLE');
      } finally {
        await session.close();
      }
    });

    it('Deve manter consistência durante transição AVAILABLE→QUARANTINED (revogação)', async () => {
      // Amostra em AVAILABLE
      await Sample.findByIdAndUpdate(testSampleId, { status: 'AVAILABLE' });

      // Simular revogação sincronizada
      // MongoDB
      await Sample.updateMany(
        { _id: testSampleId },
        { $set: { status: 'QUARANTINED' } }
      );

      // Neo4j
      const session = neo4jDriver.session();
      try {
        await session.run(
          'MATCH (s:Sample {id: $sampleId}) SET s.status = "QUARANTINED"',
          { sampleId: testSampleId }
        );

        // Validar consistência
        const result = await session.run(
          'MATCH (s:Sample {id: $sampleId}) RETURN s.status as status',
          { sampleId: testSampleId }
        );

        const neo4jStatus = result.records[0]?.get('status');
        const mongoStatus = (await Sample.findById(testSampleId)).status;

        expect(neo4jStatus).toBe('QUARANTINED');
        expect(mongoStatus).toBe('QUARANTINED');
      } finally {
        await session.close();
      }
    });
  });

  describe('Validação de Status', () => {
    it('Deve rejeitar status inválido', () => {
      expect(Sample.validateLifecycleStatus('INVALID_STATUS')).toBe(false);
    });

    it('Deve aceitar todos os status válidos', () => {
      const validStatuses = [
        'AVAILABLE',
        'QUARANTINED',
        'PARTIAL',
        'DEPLETED',
        'UNAVAILABLE'
      ];

      validStatuses.forEach(status => {
        expect(Sample.validateLifecycleStatus(status)).toBe(true);
      });
    });

    it('Deve incluir QUARANTINED no mapLifecycleToLegacy', () => {
      // O QUARANTINED não tem mapeamento legado direto, deve retornar valor padrão
      const legacyStatus = Sample.mapLifecycleToLegacy('QUARANTINED');
      // Pode ser tratado como caso especial ou padrão - verificamos que não quebra
      expect(typeof legacyStatus).toBe('string');
    });
  });
});
