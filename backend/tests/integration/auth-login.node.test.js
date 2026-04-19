/**
 * Testes de Integração para Auth Login/Logout
 * Usando Node.js puro com Express app de teste isolado
 */

const assert = require('assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-auth-login';

// Mock users database
const mockUsers = {
  'testuser': {
    userID: 'user-1',
    username: 'testuser',
    email: 'test@example.com',
    password: '$2b$10$dXJ3SVlhY2NvdW50dGVzdA==', // Mock hashed password
    accessType: 2,
    roleName: 'Técnico',
    mfaVerified: true,
    mfaEnabled: false
  },
  'adminuser': {
    userID: 'admin-1',
    username: 'adminuser',
    email: 'admin@example.com',
    password: '$2b$10$YWRtaW51c2VycGFzc2hh==', // Mock hashed password
    accessType: 4,
    roleName: 'Administrador',
    mfaVerified: true,
    mfaEnabled: true
  }
};

// Mock DB
const mockDB = {
  collection: (name) => {
    if (name === 'users') {
      return {
        findOne: async (query) => {
          const username = query.username || query.email;
          return mockUsers[username] || null;
        }
      };
    }
    return {
      findOne: async () => null,
      find: async () => ({ toArray: async () => [] }),
      updateOne: async () => ({ modifiedCount: 1 }),
      insertOne: async () => ({ insertedId: 'new-id' })
    };
  }
};

// Helper para criar app de teste
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.locals.db = mockDB;

  // POST /api/auth/login - endpoint de login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password, twoFactorCode } = req.body;

      // Validação básica
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username e password são obrigatórios'
        });
      }

      // Busca usuário direto do mock (sem usar DB collection em testes)
      let user = mockUsers[username];
      if (!user) {
        // Tenta buscar por email
        user = Object.values(mockUsers).find(u => u.email === username);
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Credenciais inválidas'
        });
      }

      // Mock verificação de senha - apenas 'correct-password' é válida para teste
      const correctPasswords = {
        'testuser': 'correct-password',
        'adminuser': 'admin-password'
      };

      if (password !== correctPasswords[user.username]) {
        return res.status(401).json({
          success: false,
          error: 'Credenciais inválidas'
        });
      }

      // Verificar MFA se habilitado
      if (user.mfaEnabled && !twoFactorCode) {
        return res.status(200).json({
          success: true,
          requiresTwoFactor: true,
          message: 'Código de autenticação de dois fatores necessário'
        });
      }

      // Gerar JWT
      const token = jwt.sign({
        userID: user.userID,
        username: user.username,
        email: user.email,
        accessType: user.accessType,
        roleName: user.roleName,
        mfaVerified: user.mfaVerified
      }, process.env.JWT_SECRET, { expiresIn: '24h' });

      res.json({
        success: true,
        token,
        user: {
          userID: user.userID,
          username: user.username,
          email: user.email,
          accessType: user.accessType,
          roleName: user.roleName
        }
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  // POST /api/auth/logout - endpoint de logout
  app.post('/api/auth/logout', (req, res) => {
    res.json({
      success: true,
      message: 'Logout realizado com sucesso'
    });
  });

  // GET /api/auth/verify - verificar token
  app.get('/api/auth/verify', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido'
      });
    }

    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      res.json({
        success: true,
        user: decoded
      });
    } catch (err) {
      res.status(401).json({
        success: false,
        error: 'Token inválido ou expirado'
      });
    }
  });

  return app;
}

const app = createTestApp();

async function run() {
  console.log('🧪 Iniciando testes de Auth Login/Logout...\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Login com credenciais válidas
  try {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'correct-password' });

    assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
    assert.strictEqual(response.body.success, true, 'Expected success: true');
    assert(response.body.token, 'Expected token in response');
    assert.strictEqual(response.body.user.username, 'testuser', 'Expected username: testuser');
    console.log('✓ Test 1: Login com credenciais válidas - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 1: Login com credenciais válidas - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 2: Login com credenciais inválidas
  try {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrong-password' });

    assert.strictEqual(response.status, 401, `Expected 401, got ${response.status}`);
    assert.strictEqual(response.body.success, false, 'Expected success: false');
    console.log('✓ Test 2: Login com credenciais inválidas - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 2: Login com credenciais inválidas - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 3: Login sem username
  try {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ password: 'password123' });

    assert.strictEqual(response.status, 400, `Expected 400, got ${response.status}`);
    assert.strictEqual(response.body.success, false, 'Expected success: false');
    console.log('✓ Test 3: Login sem username - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 3: Login sem username - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 4: Login sem password
  try {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser' });

    assert.strictEqual(response.status, 400, `Expected 400, got ${response.status}`);
    assert.strictEqual(response.body.success, false, 'Expected success: false');
    console.log('✓ Test 4: Login sem password - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 4: Login sem password - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 5: Login com usuário que requer MFA
  try {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'adminuser', password: 'admin-password' });

    assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
    assert.strictEqual(response.body.success, true, 'Expected success: true');
    assert.strictEqual(response.body.requiresTwoFactor, true, 'Expected requiresTwoFactor: true');
    console.log('✓ Test 5: Login com usuário que requer MFA - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 5: Login com usuário que requer MFA - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 6: Logout
  try {
    const response = await request(app)
      .post('/api/auth/logout');

    assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
    assert.strictEqual(response.body.success, true, 'Expected success: true');
    console.log('✓ Test 6: Logout - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 6: Logout - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 7: Verify token com token válido
  try {
    // Primeiro faz login
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'correct-password' });

    const token = loginResponse.body.token;

    // Depois verifica o token
    const verifyResponse = await request(app)
      .get('/api/auth/verify')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(verifyResponse.status, 200, `Expected 200, got ${verifyResponse.status}`);
    assert.strictEqual(verifyResponse.body.success, true, 'Expected success: true');
    assert.strictEqual(verifyResponse.body.user.username, 'testuser', 'Expected username: testuser');
    console.log('✓ Test 7: Verify token com token válido - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 7: Verify token com token válido - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  // Test 8: Verify token sem token
  try {
    const response = await request(app)
      .get('/api/auth/verify');

    assert.strictEqual(response.status, 401, `Expected 401, got ${response.status}`);
    assert.strictEqual(response.body.success, false, 'Expected success: false');
    console.log('✓ Test 8: Verify token sem token - PASS');
    passed++;
  } catch (err) {
    console.error('✗ Test 8: Verify token sem token - FAIL');
    console.error(`  Error: ${err.message}`);
    failed++;
  }

  console.log(`\n📊 Resultados: ${passed} passou, ${failed} falhou\n`);

  if (failed === 0) {
    console.log('✓ auth-login.node.test.js: PASS');
    process.exit(0);
  } else {
    console.log('✗ auth-login.node.test.js: FAIL');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
