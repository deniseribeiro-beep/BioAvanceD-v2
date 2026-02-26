/**
 * test/unit/authConsent.test.js
 * Testes de integração para middleware de bloqueio ético
 * 
 * Execução: node test/unit/authConsent.test.js
 */

const assert = require('assert');
const { authConsent, createConsentMiddleware } = require('../../src/infrastructure/middleware/authConsent');

/**
 * Mock de requisição e resposta
 */
function createMockRequest(options = {}) {
  return {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    headers: options.headers || {},
    user: options.user,
    app: {
      locals: options.db ? { db: options.db } : {}
    },
    path: options.path || '/test',
    method: options.method || 'POST'
  };
}

function createMockResponse() {
  const res = {
    statusCode: 200,
    jsonData: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.jsonData = data;
      return this;
    }
  };
  return res;
}

/**
 * Mock de banco de dados MongoDB
 */
class MockDB {
  constructor(options = {}) {
    this.consents = options.consents || [];
    this.auditLogs = [];
  }

  collection(name) {
    if (name === 'patient_consents') {
      return {
        findOne: async (query) => {
          return this.consents.find(c =>
            c.patientId === query.patientId && c.status === query.status
          ) || null;
        }
      };
    }
    return {};
  }
}

/**
 * TESTES PARA authConsent()
 */
function testConsentBlockedWhenNotFound() {
  console.log('  ✓ Teste A: Bloquear sem consentimento ativo (403)');
  
  return new Promise(async (resolve, reject) => {
    try {
      const mockDB = new MockDB({ consents: [] }); // Sem consentimentos
      const req = createMockRequest({
        body: { patientID: 'patient123' },
        db: mockDB
      });
      const res = createMockResponse();
      
      const middleware = authConsent({ patientIdResolver: 'patientID' });
      
      await middleware(req, res, () => {
        reject(new Error('next() não deveria ter sido chamado'));
      });

      assert.strictEqual(res.statusCode, 403, 'Expected 403 Forbidden');
      assert.strictEqual(res.jsonData.code, 'CONSENT_REQUIRED');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function testConsentRevokedBlocked() {
  console.log('  ✓ Teste B: Bloquear consentimento revogado (403)');
  
  return new Promise(async (resolve, reject) => {
    try {
      const mockDB = new MockDB({
        consents: [
          {
            _id: '123',
            patientId: 'patient123',
            status: 'ACTIVE', // Status ativo, mas marcado como revogado
            revokedAt: new Date('2025-01-15'),
            responses: { uso_pesquisa: true }
          }
        ]
      });

      const req = createMockRequest({
        body: { patientID: 'patient123' },
        db: mockDB
      });
      const res = createMockResponse();

      const middleware = authConsent({ patientIdResolver: 'patientID' });

      await middleware(req, res, () => {
        reject(new Error('next() não deveria ter sido chamado'));
      });

      assert.strictEqual(res.statusCode, 403, 'Expected 403 Forbidden');
      assert.strictEqual(res.jsonData.code, 'CONSENT_REVOKED');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function testConsentScopeInsufficient() {
  console.log('  ✓ Teste C: Bloquear escopo insuficiente (403)');
  
  return new Promise(async (resolve, reject) => {
    try {
      const mockDB = new MockDB({
        consents: [
          {
            _id: '123',
            patientId: 'patient123',
            status: 'ACTIVE',
            revokedAt: null,
            responses: { 
              uso_pesquisa: true  // Possui apenas este escopo
            }
          }
        ]
      });

      const req = createMockRequest({
        body: { patientID: 'patient123' },
        db: mockDB
      });
      const res = createMockResponse();

      // Exige escopo comercial que não foi consentido
      const middleware = authConsent({
        patientIdResolver: 'patientID',
        allowedScopes: ['uso_comercial'] // Não consentiu
      });

      await middleware(req, res, () => {
        reject(new Error('next() não deveria ter sido chamado'));
      });

      assert.strictEqual(res.statusCode, 403, 'Expected 403 Forbidden');
      assert.strictEqual(res.jsonData.code, 'INSUFFICIENT_SCOPE');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function testConsentValidPassed() {
  console.log('  ✓ Teste D: Permitir consentimento válido (next)');
  
  return new Promise(async (resolve, reject) => {
    try {
      const mockDB = new MockDB({
        consents: [
          {
            _id: { toString: () => 'consent-id' },
            patientId: 'patient123',
            status: 'ACTIVE',
            revokedAt: null,
            responses: { 
              uso_pesquisa: true,
              uso_comercial: true
            },
            signedAt: new Date()
          }
        ]
      });

      const req = createMockRequest({
        body: { patientID: 'patient123' },
        db: mockDB
      });
      const res = createMockResponse();

      const middleware = authConsent({
        patientIdResolver: 'patientID',
        allowedScopes: ['uso_pesquisa', 'uso_comercial']
      });

      let nextCalled = false;
      await middleware(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true, 'next() deveria ter sido chamado');
      assert.ok(req.consent, 'Dados de consentimento devem estar anexados');
      assert.strictEqual(req.consent.validated, true);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function testPatientIDMissing() {
  console.log('  ✓ Teste E: Bloquear quando PatientID ausente (400)');
  
  return new Promise(async (resolve, reject) => {
    try {
      const mockDB = new MockDB();
      const req = createMockRequest({
        body: {}, // Sem patientID
        db: mockDB
      });
      const res = createMockResponse();

      const middleware = authConsent({ patientIdResolver: 'patientID' });

      await middleware(req, res, () => {
        reject(new Error('next() não deveria ter sido chamado'));
      });

      assert.strictEqual(res.statusCode, 400, 'Expected 400 Bad Request');
      assert.strictEqual(res.jsonData.code, 'PATIENT_ID_MISSING');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function testDatabaseUnavailable() {
  console.log('  ✓ Teste F: Bloquear banco indisponível (503)');
  
  return new Promise(async (resolve, reject) => {
    try {
      const req = createMockRequest({
        body: { patientID: 'patient123' },
        db: null // Sem DB
      });
      const res = createMockResponse();

      const middleware = authConsent({ patientIdResolver: 'patientID' });

      await middleware(req, res, () => {
        reject(new Error('next() não deveria ter sido chamado'));
      });

      assert.strictEqual(res.statusCode, 503, 'Expected 503 Service Unavailable');
      assert.strictEqual(res.jsonData.code, 'DB_UNAVAILABLE');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * TESTES PARA createConsentMiddleware factories
 */
function testCreateConsentMiddlewareResearch() {
  console.log('  ✓ Teste A: Factory research() cria middleware correto');
  
  const middleware = createConsentMiddleware.research();
  assert.ok(typeof middleware === 'function', 'Deveria retornar função');
}

function testCreateConsentMiddlewareCommercial() {
  console.log('  ✓ Teste B: Factory commercial() cria middleware correto');
  
  const middleware = createConsentMiddleware.commercial();
  assert.ok(typeof middleware === 'function', 'Deveria retornar função');
}

function testCreateConsentMiddlewareGeneric() {
  console.log('  ✓ Teste C: Factory generic() cria middleware correto');
  
  const middleware = createConsentMiddleware.generic(['custom_scope']);
  assert.ok(typeof middleware === 'function', 'Deveria retornar função');
}

// ===================================================================
// RUNNER
// ===================================================================

async function runTests() {
  console.log('\n📋 SUITE DE TESTES: Auth Consent Middleware');
  console.log('==========================================\n');

  try {
    console.log('🔐 authConsent() - Middleware Principal:');
    await testConsentBlockedWhenNotFound();
    await testConsentRevokedBlocked();
    await testConsentScopeInsufficient();
    await testConsentValidPassed();
    await testPatientIDMissing();
    await testDatabaseUnavailable();
    console.log('  ✅ 6/6 testes passaram\n');

    console.log('🏭 createConsentMiddleware - Factories:');
    testCreateConsentMiddlewareResearch();
    testCreateConsentMiddlewareCommercial();
    testCreateConsentMiddlewareGeneric();
    console.log('  ✅ 3/3 testes passaram\n');

    console.log('✅ TODOS OS TESTES PASSARAM!');
    console.log('==========================================\n');

  } catch (error) {
    console.error('\n❌ TESTE FALHOU:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Executar se for o arquivo principal
if (require.main === module) {
  runTests();
}

module.exports = {
  testConsentBlockedWhenNotFound,
  testConsentRevokedBlocked,
  testConsentScopeInsufficient,
  testConsentValidPassed,
  createMockRequest,
  createMockResponse,
  MockDB
};
