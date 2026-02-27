require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const http = require("http");
const { Server } = require("socket.io");
const logger = require("./src/utils/logger");
const { connectDB } = require("./src/database/mongo");
const { connectNeo4j } = require("./src/infrastructure/database/neo4j/connection");
const LineageRepository = require("./src/infrastructure/database/neo4j/LineageRepository");
const TopologicalQuarantine = require("./src/infrastructure/queue/TopologicalQuarantine");
const TelemetryMonitor = require("./src/infrastructure/services/TelemetryMonitor");
const portManager = require("./src/utils/portManager");
const env = require("./src/config/env");
const { initScheduler } = require("./src/services/scheduler.service");
const { initializeSecuritySystem } = require("./src/infrastructure/middleware/integrationSecurityMiddleware");

const app = express();
let httpServerInstance = null;

// ==== Critical env check (halt if missing) ====
if (!env.MONGO_URI || !env.JWT_SECRET) {
  logger.error("Variáveis críticas ausentes: MONGO_URI e JWT_SECRET são obrigatórias.");
  process.exit(1);
}

// ==== CORS whitelist (env-based) ====
const allowedOrigins = (env.ALLOWED_ORIGINS || env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (allowedOrigins.length === 0) {
  allowedOrigins.push("http://localhost:3000");
}
const isDev = env.NODE_ENV !== "production";
// Add common Vite dev origins when in development
if (isDev) {
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ].forEach((origin) => {
    if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
  });
}

// Allow-all switch for troubleshooting (use only in controlled envs)
const allowAllCors = Boolean(env.CORS_ALLOW_ALL);

// Normalize origins to avoid trailing-slash or case issues
const normalizeOrigin = (origin) => {
  if (!origin) return "";
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`.replace(/\/$/, "").toLowerCase();
  } catch (_) {
    // If it's not a valid URL, fallback to trimmed lower-case
    return origin.replace(/\/$/, "").toLowerCase();
  }
};

const normalizedAllowed = new Set(allowedOrigins.map(normalizeOrigin));

// =======================
// MIDDLEWARES
// =======================
// Security headers (production-safe defaults)
app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", ...(isDev ? ["'unsafe-inline'"] : [])],
      scriptSrc: ["'self'", ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : [])],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", ...allowedOrigins],
    },
  })
);
app.use(helmet.noSniff());
app.use(helmet.frameguard({ action: "sameorigin" }));
app.use(helmet.referrerPolicy({ policy: "no-referrer" }));

// Cache-Control and Content-Type charset for API responses
app.use((req, res, next) => {
  // Don't cache API responses by default
  if (!res.headersSent) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  
  // Ensure charset=utf-8 for text-based Content-Types
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = function(name, value) {
    if (name.toLowerCase() === 'content-type' && typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      // Add charset=utf-8 if it's a text-based type and doesn't already have charset
      if ((lowerValue.startsWith('text/') || 
           lowerValue.startsWith('application/json') || 
           lowerValue.startsWith('application/xml') ||
           lowerValue.startsWith('application/javascript')) &&
          !lowerValue.includes('charset=')) {
        value = `${value}; charset=utf-8`;
      }
    }
    return originalSetHeader(name, value);
  };
  
  next();
});

// CORS restricted to whitelist
app.use(
  cors({
    origin: (origin, callback) => {
      if (allowAllCors) return callback(null, true);
      if (!origin) return callback(null, true);

      const normalizedOrigin = normalizeOrigin(origin);
      if (normalizedAllowed.has(normalizedOrigin)) return callback(null, true);

      // Also allow when only host matches (e.g., different dev ports)
      try {
        const url = new URL(origin);
        const hostOnly = `${url.protocol}//${url.hostname}`;
        if (normalizedAllowed.has(normalizeOrigin(hostOnly))) return callback(null, true);
      } catch (_) {}

      logger.warn(`CORS bloqueado para origem: ${origin}`);
      return callback(new Error("Origem não permitida pelo CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

// ==== NoSQL Injection sanitization (remove keys containing $ or .) ====
function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) sanitizeObject(item);
    return;
  }
  for (const key of Object.keys(obj)) {
    if (key.includes("$") || key.includes(".")) {
      delete obj[key];
      continue;
    }
    sanitizeObject(obj[key]);
  }
}
app.use((req, _res, next) => {
  try {
    ["body", "query", "params"].forEach((k) => sanitizeObject(req[k]));
  } catch (_) {}
  next();
});

// Idioma e auditoria
app.use(require("./src/i18n").languageMiddleware);
app.use(require("./src/infrastructure/middleware/audit.middleware").auditRequest);

// =======================
// RATE LIMITING
// =======================
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1000, // Aumentado de 100 para 1000 requisições
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Não conta requisições bem-sucedidas (2xx/3xx)
  skipFailedRequests: false,
  message: "Muitas requisições. Tente novamente mais tarde.",
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // Aumentado de 5 para 10
  message: "Muitas requisições para autenticação. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});
app.use(globalLimiter);
app.use("/api/auth", authLimiter);

// =======================
// ROTAS
// =======================
app.use("/api/auth", require("./src/interface/routes/auth.routes"));
app.use("/api/patients", require("./src/interface/routes/patient.routes"));
app.use("/api/samples", require("./src/interface/routes/sample.routes"));
app.use("/api/import", require("./src/interface/routes/import.routes"));
app.use("/api/results", require("./src/interface/routes/result.routes"));
app.use("/api/analysis-files", require("./src/interface/routes/analysis-file.routes"));
app.use("/api/analysis-types", require("./src/interface/routes/analysis-type.routes"));
app.use("/api/equipment", require("./src/interface/routes/equipment.routes"));
app.use("/api/locations", require("./src/interface/routes/location.routes"));
app.use("/api/storage", require("./src/interface/routes/storage.routes")); // ISO 20387 - Armazenagem Física (Semana 2)
app.use("/api/policies", require("./src/interface/routes/policy.routes"));
app.use("/api/sensors", require("./src/interface/routes/sensor.routes"));
app.use("/api/temperature", require("./src/interface/routes/temperature.routes"));
app.use("/api", require("./src/interface/routes/consent.routes"));
// Rotas de Gerenciamento do Sistema (Admin)
app.use("/api/users", require("./src/interface/routes/user.routes"));
app.use("/api/access", require("./src/interface/routes/access.routes"));
app.use("/api/security", require("./src/interface/routes/security.routes"));
app.use("/api/backup", require("./src/interface/routes/backup.routes"));
app.use("/api/assistant", require("./src/interface/routes/assistant.routes"));
// Rotas de Importação compatíveis com LGPD (templates e uploads)
app.use("/api/import-lgpd", require("./src/interface/routes/import-lgpd.routes"));
// ===== SECURITY & COMPLIANCE ROUTES =====
app.use("/api/compliance", require("./src/interface/routes/compliance.routes"));

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", db: !!req.app.locals.db });
});

// =======================
// SERVER + SOCKET.IO
// =======================
async function startServer() {
  try {
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

    // Seed inicial de tipos de análise
    try {
      const AnalysisTypeModel = require("./src/models/AnalysisType");
      const analysisTypesCollection = db.collection('analysisTypes');
      const existingCount = await analysisTypesCollection.countDocuments();

      if (existingCount === 0) {
        const defaults = [
          'PCR Real Time',
          'Sequenciamento (Sanger)',
          'Sequenciamento (NGS)',
          'Microscopia',
          'Eletroforese'
        ];

        const seedDocs = defaults.map((name) => ({
          name,
          code: AnalysisTypeModel.slugify(name),
          active: true,
          createdAt: new Date()
        }));

        await analysisTypesCollection.insertMany(seedDocs);
        logger.info('Tipos de análise padrão inseridos.');
      }
    } catch (seedError) {
      logger.error('Erro ao realizar seed de tipos de análise:', seedError.message);
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

    // Criar servidor HTTP unificado
    const httpServer = http.createServer(app);
    httpServerInstance = httpServer;

    // Criar Socket.IO (CORS alinhado ao app)
    const io = new Server(httpServer, {
      cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
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

startServer();

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
