const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const logger = require("./src/utils/logger");
const { connectDB } = require("./src/database/mongo");
const { connectNeo4j } = require("./src/infrastructure/database/neo4j/connection");
const LineageRepository = require("./src/infrastructure/database/neo4j/LineageRepository");
const TopologicalQuarantine = require("./src/infrastructure/queue/TopologicalQuarantine");
const TelemetryMonitor = require("./src/infrastructure/services/TelemetryMonitor");
const mqttTelemetryService = require("./src/services/mqtt-telemetry.service");
const portManager = require("./src/utils/portManager");
const env = require("./src/config/env");
const { initScheduler } = require("./src/services/scheduler.service");
const { initializeSecuritySystem } = require("./src/infrastructure/middleware/integrationSecurityMiddleware");
const { seedReportTemplates } = require("./src/services/report-template-seed.service");

let httpServerInstance = null;

// =======================
// SERVER + SOCKET.IO
// =======================
async function startServer() {
  try {
    if (!env.MONGO_URI || !env.JWT_SECRET) {
      logger.error("Variáveis críticas ausentes: MONGO_URI e JWT_SECRET são obrigatórias.");
      process.exit(1);
    }

    const PORT = parseInt(process.env.PORT || "3000");
    const actualPort = await portManager.getAvailablePort(PORT);

    logger.info(`🔌 Porta escolhida: ${actualPort}`);

    // Conecta banco
    const db = await connectDB();
    app.locals.db = db;

    // Conecta Neo4j para validação e trilha de cadeia de custódia
    try {
      app.locals.neo4jDriver = await connectNeo4j();
      logger.info("[ISO20387][NEO4J] Validação topológica ativa para operações de custódia");
    } catch (neo4jError) {
      const shouldFailHard =
        String(env.LINEAGE_MODE || 'fail-open').toLowerCase() === 'fail-closed' ||
        env.NEO4J_REQUIRED;
      logger.error("[ISO20387][NEO4J] Falha ao iniciar validação topológica:", neo4jError.message || neo4jError);
      if (shouldFailHard) {
        throw neo4jError;
      }
      app.locals.neo4jDriver = null;
      logger.warn("[ISO20387][NEO4J] Modo permissivo habilitado (dev/test): operações seguirão sem bloqueio global");
    }

    // ===== Initialize Security System =====
    logger.info("🔐 Ativando sistema de segurança e conformidade LGPD...");
    await initializeSecuritySystem(app, db);
    logger.info("✅ Sistema de segurança ativado com sucesso");

    // #737: reports.routes.js's buildPreviewData (#726) dispatches only via a
    // ReportTemplate lookup by code -- with the system rows missing, every
    // report type returns the no-preview fallback and CSV export is empty.
    // Guaranteed at boot (idempotent by code; a later hand-edit to a seeded
    // row survives) instead of a script a human has to remember -- the same
    // self-sufficiency #437 gave the RBAC catalog. Not the essential
    // reference-data seed (seed-boundary.arch.test.js keeps that off the
    // boot path by contract): 14 config rows, no manifest, no data files.
    // Non-fatal: a seed failure is logged and the server still starts.
    try {
      const { templates } = await seedReportTemplates(db);
      logger.info(`📄 Modelos de relatório do sistema garantidos: ${templates.length}`);
    } catch (seedError) {
      logger.error("Erro ao semear modelos de relatório:", seedError.message);
    }

    // Iniciar scheduler (backup + monitoramento + sync de consentimento)
    try {
      initScheduler({ db, neo4jDriver: app.locals.neo4jDriver || null });
    } catch (schedulerError) {
      logger.error('Erro ao iniciar scheduler:', schedulerError.message);
    }

    // Fila de quarentena topológica (Redis + self-healing)
    try {
      const topologicalQuarantine = new TopologicalQuarantine({
        getLineageRepository: async () => {
          if (!app.locals.neo4jDriver) {
            try {
              app.locals.neo4jDriver = await connectNeo4j();
              logger.info('[ISO20387][NEO4J] Driver recuperado para reprocessamento da quarentena');
            } catch (error) {
              logger.warn('[ISO20387][NEO4J] Ainda indisponível para worker de quarentena');
              return null;
            }
          }

          return new LineageRepository(app.locals.neo4jDriver);
        }
      });

      await topologicalQuarantine.startWorker();
      app.locals.topologicalQuarantine = topologicalQuarantine;
    } catch (queueError) {
      logger.error('[ISO20387][QUARANTINE] Falha ao iniciar worker de quarentena:', queueError.message || queueError);
      app.locals.topologicalQuarantine = null;
    }

    // Monitor de telemetria com invalidação em cascata no Neo4j
    try {
      const telemetryMonitor = new TelemetryMonitor({
        db,
        getNeo4jDriver: async () => {
          if (app.locals.neo4jDriver) {
            return app.locals.neo4jDriver;
          }

          try {
            app.locals.neo4jDriver = await connectNeo4j();
            return app.locals.neo4jDriver;
          } catch (error) {
            logger.warn('[ISO20387][TELEMETRY] Neo4j indisponível para ciclo de monitoramento');
            return null;
          }
        }
      });

      telemetryMonitor.start();
      app.locals.telemetryMonitor = telemetryMonitor;
    } catch (telemetryError) {
      logger.error('[ISO20387][TELEMETRY] Falha ao iniciar monitor:', telemetryError.message || telemetryError);
      app.locals.telemetryMonitor = null;
    }

    // Ingestão MQTT de telemetria IoT
    try {
      await mqttTelemetryService.start(db);
      app.locals.mqttTelemetryService = mqttTelemetryService;
    } catch (mqttError) {
      logger.error('[ISO20387][MQTT] Falha ao iniciar ingestão MQTT:', mqttError.message || mqttError);
      app.locals.mqttTelemetryService = null;
    }

    // Criar servidor HTTP unificado
    const httpServer = http.createServer(app);
    httpServerInstance = httpServer;

    // Criar Socket.IO (CORS alinhado ao app)
    const allowedOrigins = app.get("allowedOrigins") || [];
    const allowAllCors = app.get("allowAllCors") || false;
    const io = new Server(httpServer, {
      cors: { origin: allowAllCors ? true : allowedOrigins, methods: ["GET", "POST"], credentials: true },
    });

    io.on("connection", (socket) => {
      logger.info(`🟢 WebSocket conectado: ${socket.id}`);
      socket.on("disconnect", () => {
        logger.info(`🔴 WebSocket desconectado: ${socket.id}`);
      });
    });

    // Disponibilizar io nos serviços
    require("./src/services/notification.service").initSocketIO(io);
    require("./src/services/iot-streaming.service").initSocketIO(io);

    // Iniciar fila (Redis)
    try {
      const { initQueue, testConnection } = require("./src/config/queue");
      const queue = initQueue();

      if (queue && (await testConnection())) {
        logger.info("📦 Redis conectado");
      } else {
        logger.warn("⚠️ Redis indisponível");
      }
    } catch (err) {
      logger.error("Erro ao iniciar Redis:", err.message);
    }

    // Subir servidor final
    httpServer.listen(actualPort, "0.0.0.0", () => {
      logger.info(`🚀 API rodando em http://localhost:${actualPort}`);
      logger.info(`📡 WS ativo em ws://localhost:${actualPort}`);
    });

  } catch (err) {
    logger.error("Erro fatal ao iniciar servidor:", err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test" || process.env.RUN_SERVER_IN_TEST === "1") {
  startServer();
}

async function gracefulShutdown(signal) {
  try {
    logger.warn(`Recebido ${signal}. Encerrando serviços em background...`);

    try {
      app.locals.topologicalQuarantine?.stopWorker?.();
    } catch (error) {
      logger.error('[Shutdown] Erro ao parar quarentena topológica:', error.message || error);
    }

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

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

module.exports = { app, startServer };
