const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const logger = require('./src/utils/logger');
const { connectDB } = require('./src/database/mongo');
const TelemetryMonitor = require('./src/infrastructure/services/TelemetryMonitor');
const mqttTelemetryService = require('./src/services/mqtt-telemetry.service');
const portManager = require('./src/utils/portManager');
const env = require('./src/config/env');
const { initScheduler } = require('./src/services/scheduler.service');
const { initializeSecuritySystem } = require('./src/infrastructure/middleware/integrationSecurityMiddleware');
const { seedReportTemplates } = require('./src/services/report-template-seed.service');
const { seedRolesAndPermissions } = require('./src/services/rbac-catalog-seed.service');
const { validateEncryptionAndHalt } = require('./src/config/validateEnv');

// Install fatal-process handlers once per process. Tests reload this module in
// the same process, so the guard prevents duplicate listeners.
if (!process.__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__) {
  process.__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__ = true;

  process.on('unhandledRejection', (reason) => {
    logger.error('[#1040] unhandledRejection não tratada -- encerrando servidor:', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.error('[#1040] uncaughtException -- encerrando servidor:', err);
    process.exit(1);
  });
}

let httpServerInstance = null;

/**
 * HTTP application runtime.
 *
 * RF023 v2 boundary: this process never opens Neo4j for domain operations.
 * MongoDB is authoritative and domain mutations append to the durable
 * transactional outbox. Neo4j connectivity belongs exclusively to the
 * projection/rebuild worker boundary.
 */
async function startServer() {
  try {
    if (!env.MONGO_URI || !env.JWT_SECRET || !env.USER_ANON_SALT || !String(env.CONSENT_SECRET || '').trim()) {
      logger.error('Variáveis críticas ausentes: MONGO_URI, JWT_SECRET, USER_ANON_SALT e CONSENT_SECRET são obrigatórias.');
      process.exit(1);
    }

    validateEncryptionAndHalt();

    const PORT = parseInt(process.env.PORT || '3000', 10);
    const actualPort = await portManager.getAvailablePort(PORT);
    logger.info(`🔌 Porta escolhida: ${actualPort}`);

    const db = await connectDB();
    app.locals.db = db;

    logger.info('🔐 Ativando sistema de segurança e conformidade LGPD...');
    await initializeSecuritySystem(app, db);
    logger.info('✅ Sistema de segurança ativado com sucesso');

    // Catalogs are idempotent and intentionally guaranteed at boot. They are
    // configuration/reference catalogs, not operational specimen data.
    try {
      const { roles, permissions } = await seedRolesAndPermissions(db);
      logger.info(`🔑 Catálogo RBAC garantido: ${roles.length} papéis, ${permissions.length} permissões`);
    } catch (rbacSeedError) {
      logger.error('Erro ao semear catálogo RBAC:', rbacSeedError.message);
    }

    try {
      const { templates } = await seedReportTemplates(db);
      logger.info(`📄 Modelos de relatório do sistema garantidos: ${templates.length}`);
    } catch (seedError) {
      logger.error('Erro ao semear modelos de relatório:', seedError.message);
    }

    try {
      initScheduler({ db });
    } catch (schedulerError) {
      logger.error('Erro ao iniciar scheduler:', schedulerError.message);
    }

    // Telemetry v2 reads raw measurements from InfluxDB, writes canonical
    // exposure summaries/operational decisions in MongoDB and appends graph
    // projection events to the outbox. It has no Neo4j dependency.
    try {
      const telemetryMonitor = new TelemetryMonitor({ db });
      telemetryMonitor.start();
      app.locals.telemetryMonitor = telemetryMonitor;
    } catch (telemetryError) {
      logger.error('[ISO20387][TELEMETRY] Falha ao iniciar monitor:', telemetryError.message || telemetryError);
      app.locals.telemetryMonitor = null;
    }

    try {
      await mqttTelemetryService.start(db);
      app.locals.mqttTelemetryService = mqttTelemetryService;
    } catch (mqttError) {
      logger.error('[ISO20387][MQTT] Falha ao iniciar ingestão MQTT:', mqttError.message || mqttError);
      app.locals.mqttTelemetryService = null;
    }

    const httpServer = http.createServer(app);
    httpServerInstance = httpServer;

    const allowedOrigins = app.get('allowedOrigins') || [];
    const allowAllCors = app.get('allowAllCors') || false;
    const io = new Server(httpServer, {
      cors: { origin: allowAllCors ? true : allowedOrigins, methods: ['GET', 'POST'], credentials: true },
    });

    io.on('connection', (socket) => {
      logger.info(`🟢 WebSocket conectado: ${socket.id}`);
      socket.on('disconnect', () => {
        logger.info(`🔴 WebSocket desconectado: ${socket.id}`);
      });
    });

    require('./src/services/notification.service').initSocketIO(io);
    require('./src/services/iot-streaming.service').initSocketIO(io);

    // Redis is optional for the synchronous HTTP process. Queue workers keep
    // their own stricter readiness policy.
    try {
      const { initQueue, testConnection } = require('./src/config/queue');
      const queue = initQueue();
      if (queue && (await testConnection())) {
        logger.info('📦 Redis conectado');
      } else {
        logger.warn('⚠️ Redis indisponível');
      }
    } catch (err) {
      logger.error('Erro ao iniciar Redis:', err.message);
    }

    httpServer.listen(actualPort, '0.0.0.0', () => {
      logger.info(`🚀 API rodando em http://localhost:${actualPort}`);
      logger.info(`📡 WS ativo em ws://localhost:${actualPort}`);
    });
  } catch (err) {
    logger.error('Erro fatal ao iniciar servidor:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' || process.env.RUN_SERVER_IN_TEST === '1') {
  startServer();
}

async function gracefulShutdown(signal) {
  try {
    logger.warn(`Recebido ${signal}. Encerrando serviços em background...`);

    try {
      app.locals.telemetryMonitor?.stop?.();
    } catch (error) {
      logger.error('[Shutdown] Erro ao parar monitor de telemetria:', error.message || error);
    }

    try {
      await app.locals.mqttTelemetryService?.stop?.();
    } catch (error) {
      logger.error('[Shutdown] Erro ao parar ingestão MQTT:', error.message || error);
    }

    if (httpServerInstance) {
      await new Promise((resolve) => httpServerInstance.close(() => resolve()));
    }

    process.exit(0);
  } catch (error) {
    logger.error('[Shutdown] Falha ao encerrar aplicação:', error.message || error);
    process.exit(1);
  }
}

if (!process.__BIOAVANCE_1047_SERVER_SIGNAL_HANDLERS_INSTALLED__) {
  process.__BIOAVANCE_1047_SERVER_SIGNAL_HANDLERS_INSTALLED__ = true;

  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });
}

module.exports = { app, startServer };
