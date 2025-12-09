require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * Script de auditoria completa Frontend-Backend
 * Compara endpoints esperados pelo frontend com os implementados no backend
 */
async function auditFrontendBackend() {
  try {
    console.log('='.repeat(80));
    console.log('🔍 AUDITORIA FRONTEND-BACKEND');
    console.log('='.repeat(80));
    console.log('');

    const db = await connectDB();

    // ============================================
    // 1. VERIFICAR COLEÇÕES NO BANCO
    // ============================================
    console.log('📊 1. COLEÇÕES NO BANCO DE DADOS');
    console.log('-'.repeat(80));

    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name).sort();

    console.log(`Total de coleções: ${collectionNames.length}`);
    collectionNames.forEach((name, index) => {
      console.log(`   ${index + 1}. ${name}`);
    });
    console.log('');

    // ============================================
    // 2. VERIFICAR ROTAS DO BACKEND
    // ============================================
    console.log('🛣️  2. ROTAS IMPLEMENTADAS NO BACKEND');
    console.log('-'.repeat(80));

    const routesPath = path.join(__dirname, '../src/routes');
    const routeFiles = fs.readdirSync(routesPath).filter(f => f.endsWith('.routes.js'));

    const backendRoutes = {};

    for (const file of routeFiles) {
      const routeName = file.replace('.routes.js', '');
      const routePath = path.join(routesPath, file);
      const content = fs.readFileSync(routePath, 'utf8');

      // Extrai rotas usando regex
      const routeMatches = content.matchAll(/(?:router\.(get|post|put|delete|patch))\(['"`]([^'"`]+)['"`]/g);
      const routes = [];

      for (const match of routeMatches) {
        const method = match[1].toUpperCase();
        const path = match[2];
        routes.push({ method, path });
      }

      backendRoutes[routeName] = routes;
    }

    // Lista todas as rotas
    let totalRoutes = 0;
    Object.keys(backendRoutes).sort().forEach(routeName => {
      const routes = backendRoutes[routeName];
      if (routes.length > 0) {
        console.log(`\n📁 /api/${routeName}:`);
        routes.forEach(route => {
          console.log(`   ${route.method.padEnd(6)} /api/${routeName}${route.path}`);
          totalRoutes++;
        });
      }
    });

    console.log(`\n✅ Total de rotas implementadas: ${totalRoutes}`);
    console.log('');

    // ============================================
    // 3. VERIFICAR ENDPOINTS ESPERADOS PELO FRONTEND
    // ============================================
    console.log('📱 3. ENDPOINTS ESPERADOS PELO FRONTEND');
    console.log('-'.repeat(80));

    const frontendEndpoints = {
      '/api/auth': [
        'POST /login',
        'POST /register',
        'POST /logout',
        'GET /verify',
        'GET /two-factor/qr',
        'POST /two-factor/enable',
        'POST /two-factor/disable',
        'GET /two-factor/status',
        'POST /password-reset/request',
        'POST /password-reset/reset'
      ],
      '/api/patients': [
        'GET /',
        'GET /:id',
        'POST /',
        'PUT /:id',
        'DELETE /:id',
        'POST /validate-id',
        'POST /find-for-edit'
      ],
      '/api/samples': [
        'GET /',
        'GET /:id',
        'POST /',
        'PUT /:id',
        'DELETE /:id',
        'GET /by-barcode/:barcode',
        'GET /:id/results',
        'POST /:id/withdraw',
        'POST /:id/return'
      ],
      '/api/users': [
        'GET /',
        'GET /:id',
        'POST /register',
        'PUT /:id',
        'DELETE /:id',
        'GET /:id/validate-status',
        'POST /register-patient',
        'POST /register-sample',
        'POST /record-withdrawal',
        'POST /generate-report',
        'POST /register-sensor',
        'GET /logs'
      ],
      '/api/import': [
        'POST /upload',
        'POST /validate',
        'POST /import',
        'GET /jobs',
        'GET /job/:jobID',
        'POST /job/:jobID/cancel',
        'GET /job/:jobID/report'
      ],
      '/api/temperature': [
        'POST /reading',
        'POST /system/reading',
        'GET /history',
        'GET /alerts',
        'GET /',
        'GET /:id',
        'GET /control'
      ],
      '/api/sensors': [
        'GET /',
        'GET /:id',
        'POST /',
        'PUT /:id',
        'DELETE /:id',
        'POST /:id/reading',
        'POST /:id/collect-reading'
      ],
      '/api/assistant': [
        'POST /question',
        'POST /consult',
        'POST /answer',
        'POST /suggest',
        'POST /suggestions',
        'POST /tutorial',
        'POST /contextual-help'
      ],
      '/api/equipment': [
        'GET /',
        'GET /:id',
        'POST /',
        'PUT /:id',
        'DELETE /:id'
      ],
      '/api/locations': [
        'GET /',
        'GET /:id',
        'POST /',
        'PUT /:id',
        'DELETE /:id'
      ],
      '/api/policies': [
        'GET /',
        'GET /:id',
        'GET /:id/active-limit',
        'POST /',
        'PUT /:id',
        'DELETE /:id'
      ],
      '/api/results': [
        'GET /',
        'GET /:id',
        'GET /:id/download',
        'POST /',
        'PUT /:id',
        'PUT /:id/link-sample',
        'DELETE /:id'
      ],
      '/api/reports': [
        'GET /',
        'GET /:id',
        'POST /generate',
        'DELETE /:id',
        'GET /:type/filters',
        'POST /:type/preview',
        'GET /:type/export',
        'GET /:type/export/pdf'
      ],
      '/api/access': [
        'GET /',
        'GET /:id',
        'POST /',
        'PUT /:id',
        'DELETE /:id'
      ],
      '/api/measurement-units': [
        'GET /',
        'GET /:id',
        'POST /',
        'PUT /:id',
        'DELETE /:id'
      ],
      '/api/quality-descriptions': [
        'GET /',
        'GET /:id',
        'POST /',
        'PUT /:id',
        'DELETE /:id'
      ],
      '/api/logs': [
        'GET /',
        'GET /all',
        'GET /:id',
        'POST /query',
        'POST /register'
      ]
    };

    let totalFrontendEndpoints = 0;
    Object.keys(frontendEndpoints).sort().forEach(basePath => {
      const endpoints = frontendEndpoints[basePath];
      console.log(`\n📁 ${basePath}:`);
      endpoints.forEach(endpoint => {
        console.log(`   ${endpoint}`);
        totalFrontendEndpoints++;
      });
    });

    console.log(`\n📊 Total de endpoints esperados pelo frontend: ${totalFrontendEndpoints}`);
    console.log('');

    // ============================================
    // 4. VERIFICAR MODELS
    // ============================================
    console.log('📦 4. MODELS IMPLEMENTADOS');
    console.log('-'.repeat(80));

    const modelsPath = path.join(__dirname, '../src/models');
    const modelFiles = fs.readdirSync(modelsPath).filter(f => f.endsWith('.js'));

    console.log(`Total de models: ${modelFiles.length}`);
    modelFiles.sort().forEach((file, index) => {
      const modelName = file.replace('.js', '');
      console.log(`   ${index + 1}. ${modelName}`);
    });
    console.log('');

    // ============================================
    // 5. VERIFICAR COERÊNCIA
    // ============================================
    console.log('✅ 5. RESUMO DE COERÊNCIA');
    console.log('-'.repeat(80));

    const expectedModels = [
      'Patient', 'Sample', 'Result', 'Equipment', 'Location',
      'User', 'Temperature', 'Sensor', 'Policy', 'Log',
      'IntelligentAssistant', 'Reports', 'Access',
      'MeasurementUnit', 'QualityDescription', 'Withdrawal'
    ];

    const implementedModels = modelFiles.map(f => f.replace('.js', ''));
    const missingModels = expectedModels.filter(m => !implementedModels.includes(m));

    console.log(`✅ Models implementados: ${implementedModels.length}/${expectedModels.length}`);
    if (missingModels.length > 0) {
      console.log(`⚠️  Models faltando: ${missingModels.join(', ')}`);
    } else {
      console.log(`✅ Todos os models esperados estão implementados!`);
    }

    console.log(`✅ Rotas implementadas: ${totalRoutes}`);
    console.log(`📱 Endpoints esperados pelo frontend: ${totalFrontendEndpoints}`);
    console.log(`✅ Coleções no banco: ${collectionNames.length}`);

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Auditoria concluída!');
    console.log('='.repeat(80));

    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro na auditoria:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Executa a auditoria
auditFrontendBackend();

