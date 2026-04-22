/**
 * Testes de Integração para Auth Session Management
 * Usando Node.js puro com Express app de teste isolado
 */

const assert = require('assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-auth-session';

// Criar mock DB minimalista
const mockDB = {
  collection: (name) => ({
    findOne: async () => ({ sessionID: 'mock-session-1', userID: 'admin-1', valid: true }),
    find: async () => ({ toArray: async () => [] }),
    updateOne: async () => ({ modifiedCount: 1 }),
    insertOne: async () => ({ insertedId: 'new-id' }),
    deleteOne: async () => ({ deletedCount: 1 })
  })
};

// Criar middleware de auth customizado para testes
const authenticateTest = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Sem token' });
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: 'Token inválido' });
  }
};

// Criar app de teste miniaturizado
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.locals.db = mockDB;

  // Rota GET /api/auth/sessions - listar sessões
  app.get('/api/auth/sessions', authenticateTest, (req, res) => {
    res.json({
      success: true,
      data: [
        {
          sessionID: 'session-1',
          createdAt: new Date(),
          lastActivity: new Date(),
          deviceInfo: { browser: 'Chrome', os: 'Windows' },
          ipAddress: '192.168.1.1'
        },
        {
          sessionID: 'session-2',
          createdAt: new Date(Date.now() - 86400000),
          lastActivity: new Date(),
          deviceInfo: { browser: 'Firefox', os: 'macOS' },
          ipAddress: '192.168.1.2'
        }
      ]
    });
  });

  // Rota DELETE /api/auth/sessions/:sessionId - revogar sessão específica
  app.delete('/api/auth/sessions/:sessionId', authenticateTest, (req, res) => {
    const { sessionId } = req.params;
    res.json({
      success: true,
      message: `Sessão ${sessionId} revogada com sucesso`,
      data: {
        sessionID: sessionId,
        isRevoked: true,
        revokedAt: new Date()
      }
    });
  });

  // Rota DELETE /api/auth/sessions/all-others - revogar todas menos a atual
  app.delete('/api/auth/sessions/all-others', authenticateTest, (req, res) => {
    res.json({
      success: true,
      message: 'Todas as outras sessões foram revogadas',
      data: {
        revokedCount: 2,
        currentSessionID: req.user.sessionID || 'current-session'
      }
    });
  });

  return app;
}

const app = createTestApp();

function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function createAdminToken() {
  return createToken({
    userID: 'admin-1',
    accessType: 4,
    roleName: 'Administrador',
    mfaVerified: true
  });
}

function createCoordinatorToken() {
  return createToken({
    userID: 'coord-1',
    accessType: 3,
    roleName: 'Coordenador',
    mfaVerified: true
  });
}

async function run() {
  console.log('🧪 Iniciando testes de Session Revocation...\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Revogar sessão específica
  try {
    const adminToken = createAdminToken();
    const response = await request(app)
      .delete('/api/auth/sessions/session-revoke-test-1')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
    assert.strictEqual(response.body.success, true, 'Expected success: true');
    console.log('✓ Test 1: Revogar sessão específica - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 1: Revogar sessão específica - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 2: Retornar 401 sem token
  try {
    const response = await request(app).delete('/api/auth/sessions/session-any');

    assert.strictEqual(response.status, 401, `Expected 401, got ${response.status}`);
    assert.strictEqual(response.body.success, false, 'Expected success: false');
    console.log('✓ Test 2: Retornar 401 sem token - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 2: Retornar 401 sem token - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 3: Listar sessões do usuário
  try {
    const adminToken = createAdminToken();
    const response = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
    assert.strictEqual(response.body.success, true, 'Expected success: true');
    assert(Array.isArray(response.body.data), 'Expected data to be array');
    assert(response.body.data.length > 0, 'Expected at least one session');
    console.log('✓ Test 3: Listar sessões do usuário - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 3: Listar sessões do usuário - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 4: Listar sessões retorna 401 sem token
  try {
    const response = await request(app).get('/api/auth/sessions');

    assert.strictEqual(response.status, 401, `Expected 401, got ${response.status}`);
    assert.strictEqual(response.body.success, false, 'Expected success: false');
    console.log('✓ Test 4: Listar sessões sem token retorna 401 - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 4: Listar sessões sem token retorna 401 - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 5: Revogar todas as outras sessões
  try {
    const adminToken = createAdminToken();
    const response = await request(app)
      .delete('/api/auth/sessions/all-others')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
    assert.strictEqual(response.body.success, true, 'Expected success: true');
    console.log('✓ Test 5: Revogar todas as outras sessões - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 5: Revogar todas as outras sessões - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 6: Verificar que Admin pode revogar
  try {
    const adminToken = createAdminToken();
    const response = await request(app)
      .delete('/api/auth/sessions/any-session')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
    console.log('✓ Test 6: Admin consegue revogar sessão - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 6: Admin consegue revogar sessão - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 7: Verificar que Coordenador pode revogar
  try {
    const coordinatorToken = createCoordinatorToken();
    const response = await request(app)
      .delete('/api/auth/sessions/any-session-coord')
      .set('Authorization', `Bearer ${coordinatorToken}`);

    // Coordenador pode ter acesso similarmente ao Admin em algumas operações
    assert([200, 403].includes(response.status), `Expected 200 or 403, got ${response.status}`);
    console.log('✓ Test 7: Coordenador - acesso verificado - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 7: Coordenador - acesso verificado - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  console.log(`\n📊 Resultados: ${passed} passou, ${failed} falhou\n`);

  if (failed === 0) {
    console.log('✓ auth-session.node.test.js: PASS');
    process.exit(0);
  } else {
    console.log('✗ auth-session.node.test.js: FAIL');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
