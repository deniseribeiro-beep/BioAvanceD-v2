const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const logger = require("./src/utils/logger");
const { connectDB } = require("./src/database/mongo");
const { connectMongoDB } = require("./src/infrastructure/database/mongodb/connection");
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
const { seedRolesAndPermissions } = require("./src/services/rbac-catalog-seed.service");
const { validateEncryptionAndHalt, validateAuditSigningAndWarn } = require("./src/config/validateEnv");

// #1040: Model.createIndexes() index-build errors (and unhandled rejections
// generally) reach `Model.emit('error')` on a Mongoose Model with no default
// 'error' listener, which throws outside any try/catch the caller's `await`
// owns -- so before this handler existed the process died anonymously,
// unattributed, on whatever this happened to interrupt.
//
// Observability-only: log with attribution, then still terminate exactly as
// the rest of this file already does on a fatal startup error (see the
// startServer() catch below). Do NOT turn this into a swallow/continue path
// -- three call sites in this codebase deliberately rely on "an unhandled
// rejection kills this process" staying true: src/services/auth.service.js:540,
// src/services/consent.service.js:911 and src/utils/collectionResolver.js:23.
//
// Registered before any other startup work so a rejection during startup is
// also caught. Guarded on `process` itself (not on this module) because this
// file, src/workers/worker.js, src/workers/import-worker.js and
// src/workers/neo4jProjection.worker.js each install the same pair of
// handlers, and worker.js requires import-worker.js into the very same OS
// process -- an unguarded second `process.on()` would just mean two log
// lines and two process.exit() races on one real event, not a bug, but the
// guard makes that explicit instead of accidental.
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

// =======================
// SERVER + SOCKET.IO
// =======================
async function startServer() {
  try {
    // #972: USER_ANON_SALT juntou-se às críticas. Sem ele a pseudonimização
    // de usuários (RNF007/LGPD) não tem salt, e generateAnonId agora falha
    // fechado em vez de cair num literal público -- mas o erro apareceria no
    // primeiro registro de usuário, não no boot. Aqui ele é alto e imediato,
    // como MONGO_URI e JWT_SECRET.
    // #1097: CONSENT_SECRET joins the criticals. It was already mandatory --
    // eConsent.js threw on it at MODULE LOAD, which fired during
    // require("./app") on line 3, before the #1040 handlers were installed and
    // before this guard ran. The refusal is unchanged; what changes is that it
    // is now logged, attributed, and no longer masks its siblings by aborting
    // the boot before they are evaluated.
    if (!env.MONGO_URI || !env.JWT_SECRET || !env.USER_ANON_SALT || !String(env.CONSENT_SECRET || '').trim()) {
      logger.error("Variáveis críticas ausentes: MONGO_URI, JWT_SECRET, USER_ANON_SALT e CONSENT_SECRET são obrigatórias.");
      process.exit(1);
    }

    // #1085: até aqui NADA validava ENCRYPTION_KEY no boot e nada avisava
    // quando ALLOW_UNENCRYPTED_FILE_STORAGE / ALLOW_UNENCRYPTED_FIELD_STORAGE
    // estavam ligados -- validateAllEnv/validateAndHalt existem desde sempre e
    // não têm um único chamador de produção, então "adicionar um aviso ao
    // validateEnv.js" não produziria saída observável nenhuma. Este é o
    // chamador que faltava. Aviso alto em todo ambiente, fatal em produção
    // (direção 3); o throw cai no catch de startup abaixo, que já encerra com
    // process.exit(1) do mesmo jeito que o bloco acima.
    //
    // Um stack de produção copiado de .env.production.example sobe hoje com
    // ENCRYPTION_KEY em branco (#978, "sete chaves em branco"). A partir daqui
    // ele recusa subir, ruidosamente, em vez de guardar identidade civil em
    // texto claro em silêncio.
    validateEncryptionAndHalt();

    // #1154: mesma posição, severidade deliberadamente diferente -- avisa e
    // segue, em qualquer ambiente. O backend não sela raízes (quem sela é o
    // job noturno no worker), mas os dois containers compartilham o mesmo
    // arquivo de ambiente, então uma configuração quebrada fica visível aqui
    // horas antes de o worker chegar às 02:30 UTC.
    // NÃO aguardado de propósito: a checagem é um diagnóstico, não um portão.
    // Aguardá-la atrasaria httpServer.listen() por duas leituras de arquivo sem
    // nada depender do resultado -- a direção 1 de #1154 promete nenhuma mudança
    // de comportamento, e isso inclui a ordem do boot. O catch é defensivo: uma
    // rejeição não tratada aqui cairia no handler de #1040 e derrubaria o
    // processo, invertendo a postura desta função.
    validateAuditSigningAndWarn().catch(() => {});

    const PORT = parseInt(process.env.PORT || "3000");
    const actualPort = await portManager.getAvailablePort(PORT);

    logger.info(`🔌 Porta escolhida: ${actualPort}`);

    // Conecta banco
    const db = await connectDB();
    app.locals.db = db;

    // #830/#826: modelos Mongoose ainda são consultados pela API (p.ex.
    // Sample.findById em miabisValidator, e os modelos de hierarquia de
    // armazenamento). Sem conexão o Mongoose enfileira a operação e a rejeita
    // após 10s, em silêncio. A conexão existia só como efeito colateral de
    // rotas como o upload de lote -- que #830 levou para o driver nativo --,
    // então passa a ser aberta aqui, explicitamente, no boot.
    await connectMongoDB();

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

    // #1260: the logger's minimum level follows security_config's
    // logging.level. Read once now, then polled, so a level saved through
    // another replica reaches this process within a minute. syncLogLevel
    // never throws; unref() keeps the poll from holding the process open.
    const securityService = require("./src/services/security.service");
    await securityService.syncLogLevel(db);
    setInterval(() => securityService.syncLogLevel(db), 60 * 1000).unref();

    // #916: the RBAC catalog reached a live database ONLY at first-admin
    // bootstrap -- createFirstAdmin early-returns on `users_exist`, and the
    // two standalone scripts have no npm entry and no compose service. So a
    // permission code added after a deployment's first boot had no Permission
    // document, and userHasPermission answers false for a missing document:
    // every route using that code 403s for every user including Administrador,
    // silently, with nothing failing loudly. (An unknown code is the LOUD
    // failure -- requirePermission 500s on that. The missing-document case is
    // the quiet one.)
    //
    // #737's comment below cites "the same self-sufficiency #437 gave the RBAC
    // catalog" -- a property the catalog did not actually have. This is what
    // makes that sentence true.
    //
    // Safe to run every boot: upsertPermission inserts a missing
    // permissionCode and RECONCILES an already-seeded one's catalog-owned
    // fields rather than skipping it (#1075), and upsertRole MERGES freshly
    // computed permissionIds into an existing role rather than skipping it
    // (#646) -- both test-pinned. The latter is exactly the "new permission
    // granted to an existing role" case. Permitted on the boot
    // path -- seed-boundary.arch.test.js fences off seed-essential-reference-
    // data specifically, not this. Non-fatal, same shape as the seed below.
    try {
      const { roles, permissions } = await seedRolesAndPermissions(db);
      logger.info(`🔑 Catálogo RBAC garantido: ${roles.length} papéis, ${permissions.length} permissões`);
    } catch (rbacSeedError) {
      logger.error("Erro ao semear catálogo RBAC:", rbacSeedError.message);
    }

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

    // #977: deliberate posture -- a Redis configuration or connectivity
    // failure is NOT fatal for the backend. The synchronous HTTP routes do
    // not depend on the queue; only import enqueueing degrades, and
    // getQueue() retries on demand. Hence the catch below logs and falls
    // through to listen(), leaving the container healthy.
    //
    // The worker process makes the OPPOSITE choice (src/workers/worker.js,
    // process.exit(1)) over exactly the same three checks -- validateRedisOnly,
    // initRedis and testRedisConnection. The divergence is intentional, not an
    // oversight: read #977 before changing either end, and change both or
    // neither.
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

// #1047: guarded on `process`, not on this module, for the same reason as
// the #1040 pair above -- this file is deleted from require.cache and
// re-required repeatedly within a single vitest process (see
// tests/unit/process-fatal-handlers.1040.test.js), and without a guard each
// reload adds another SIGINT/SIGTERM listener on the one real `process`
// object underneath every reload. Production never sees the duplication
// this guards against (server.js and src/workers/worker.js run in separate
// containers and never share a process) -- this is a test-hygiene guard,
// not a production double-registration fix.
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
