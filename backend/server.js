require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const http = require("http");
const { Server } = require("socket.io");
const logger = require("./src/utils/logger");
const { connectDB } = require("./src/database/mongo");
const portManager = require("./src/utils/portManager");

const app = express();

// =======================
// MIDDLEWARES
// =======================
// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Needed for Vite dev
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
  xContentTypeOptions: true,
  hidePoweredBy: true, // Remove X-Powered-By header
}));

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

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Idioma e auditoria
app.use(require("./src/i18n").languageMiddleware);
app.use(require("./src/middleware/audit.middleware").auditRequest);

// =======================
// ROTAS
// =======================
app.use("/api/auth", require("./src/routes/auth.routes"));
app.use("/api/patients", require("./src/routes/patient.routes"));
app.use("/api/samples", require("./src/routes/sample.routes"));
app.use("/api/import", require("./src/routes/import.routes"));
app.use("/api/results", require("./src/routes/result.routes"));
app.use("/api/equipment", require("./src/routes/equipment.routes"));
app.use("/api/locations", require("./src/routes/location.routes"));
app.use("/api/policies", require("./src/routes/policy.routes"));
app.use("/api/sensors", require("./src/routes/sensor.routes"));
app.use("/api/temperature", require("./src/routes/temperature.routes"));

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

    // Criar servidor HTTP unificado
    const httpServer = http.createServer(app);

    // Criar Socket.IO
    const io = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] },
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
