require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const logger = require("./src/utils/logger");
const env = require("./src/config/env");

const app = express();



function parseTrustProxy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (value === undefined || value === null || value === "") return false;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["false", "0", "off", "no"].includes(normalized)) return false;
    if (["true", "1", "on", "yes"].includes(normalized)) return 1;

    const numericValue = Number(normalized);
    if (Number.isInteger(numericValue) && numericValue >= 0) {
      return numericValue;
    }

    return value;
  }

  return false;
}

app.set("trust proxy", parseTrustProxy(env.TRUST_PROXY));

const normalizeOrigin = (origin) => {
  if (!origin) return "";

  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`.replace(/\/$/, "").toLowerCase();
  } catch (_) {
    return origin.replace(/\/$/, "").toLowerCase();
  }
};

function addAllowedOrigin(origins, seenOrigins, origin) {
  const trimmedOrigin = String(origin || "").trim();
  if (!trimmedOrigin) return;

  const normalizedOrigin = normalizeOrigin(trimmedOrigin);
  if (!normalizedOrigin || seenOrigins.has(normalizedOrigin)) return;

  origins.push(trimmedOrigin.replace(/\/$/, ""));
  seenOrigins.add(normalizedOrigin);
}

function addAllowedOrigins(origins, seenOrigins, value) {
  String(value || "")
    .split(",")
    .forEach((origin) => addAllowedOrigin(origins, seenOrigins, origin));
}

const allowedOrigins = [];
const seenAllowedOrigins = new Set();
addAllowedOrigins(allowedOrigins, seenAllowedOrigins, env.ALLOWED_ORIGINS);
addAllowedOrigin(allowedOrigins, seenAllowedOrigins, env.FRONTEND_URL);
if (allowedOrigins.length === 0) {
  addAllowedOrigin(allowedOrigins, seenAllowedOrigins, "http://localhost:5173");
}

const isDev = env.NODE_ENV !== "production";
if (isDev) {
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ].forEach((origin) => {
    addAllowedOrigin(allowedOrigins, seenAllowedOrigins, origin);
  });
}

const allowAllCors = Boolean(env.CORS_ALLOW_ALL);

const normalizedAllowed = new Set(allowedOrigins.map(normalizeOrigin));

app.set("allowedOrigins", allowedOrigins);
app.set("allowAllCors", allowAllCors);

app.use(
  helmet({
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);
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

app.use((req, res, next) => {
  if (!res.headersSent) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  }

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = function setHeaderWithCharset(name, value) {
    if (name.toLowerCase() === "content-type" && typeof value === "string") {
      const lowerValue = value.toLowerCase();
      if (
        (lowerValue.startsWith("text/") ||
          lowerValue.startsWith("application/json") ||
          lowerValue.startsWith("application/xml") ||
          lowerValue.startsWith("application/javascript")) &&
        !lowerValue.includes("charset=")
      ) {
        value = `${value}; charset=utf-8`;
      }
    }

    return originalSetHeader(name, value);
  };

  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (allowAllCors) return callback(null, true);
      if (!origin) return callback(null, true);

      const normalizedOrigin = normalizeOrigin(origin);
      if (normalizedAllowed.has(normalizedOrigin)) return callback(null, true);

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
    ["body", "query", "params"].forEach((part) => sanitizeObject(req[part]));
  } catch (_) {}
  next();
});

app.use(require("./src/i18n").languageMiddleware);
app.use(require("./src/infrastructure/middleware/audit.middleware").auditRequest);

const isTest = env.NODE_ENV === "test";

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skipFailedRequests: false,
  message: "Muitas requisições. Tente novamente mais tarde.",
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Strict brute-force budget everywhere by default. The real Docker dev
  // stack (compose.yml + compose.dev.yml) needs enough headroom that a
  // real-backend e2e spec file doing several logins/2FA calls per minute
  // doesn't 429 (#350) -- but per RNF008.6, that relaxation can't be
  // inferred from NODE_ENV/isDev (a generic indicator every non-production
  // run shares, including a staging deploy that just left NODE_ENV unset).
  // It requires the explicit, isolated AUTH_RATE_LIMIT_RELAXED opt-in that
  // only that compose file's environment sets (#359), and even then never
  // applies in production.
  max: (env.AUTH_RATE_LIMIT_RELAXED && env.NODE_ENV !== "production") ? 100 : 10,
  message: "Muitas requisições para autenticação. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

if (!isTest) {
  app.use(globalLimiter);
  app.use("/api/auth", authLimiter);
}

app.use("/api/auth", require("./src/interface/routes/auth.routes"));
app.use("/api/orphanet", require("./src/interface/routes/orphanet.routes"));
app.use("/api/hpo", require("./src/interface/routes/hpo.routes"));
app.use("/api/patients", require("./src/interface/routes/patient.routes"));
app.use("/api/v1/patients", require("./src/interface/routes/patient.routes"));
app.use("/api/samples", require("./src/interface/routes/sample.routes"));
app.use("/api/labels", require("./src/interface/routes/label.routes"));
app.use("/api/quality", require("./src/interface/routes/quality.routes"));
app.use("/api/import", require("./src/interface/routes/import.routes"));
app.use("/api/results", require("./src/interface/routes/result.routes"));
app.use("/api/reports", require("./src/interface/routes/reports.routes"));
app.use("/api/logs", require("./src/interface/routes/logs.routes"));
app.use("/api/audit", require("./src/interface/routes/audit.routes"));
app.use("/api/analysis-files", require("./src/interface/routes/analysis-file.routes"));
app.use("/api/analysis-types", require("./src/interface/routes/analysis-type.routes"));
const createMasterDataRouter = require("./src/interface/routes/master-data.routes");
app.use("/api/measurement-units", createMasterDataRouter({
  collectionName: "measurementUnits",
  idField: "unitID",
  model: require("./src/models/MeasurementUnit")
}));
app.use("/api/quality-descriptions", createMasterDataRouter({
  collectionName: "qualityDescriptions",
  idField: "qualityID",
  model: require("./src/models/QualityDescription")
}));
app.use("/api/sample-types", createMasterDataRouter({
  collectionName: "sampleTypes",
  idField: "sampleTypeID",
  model: require("./src/models/SampleType")
}));
app.use("/api/sample-origins", createMasterDataRouter({
  collectionName: "sampleOrigins",
  idField: "originID",
  model: require("./src/models/SampleOrigin")
}));
app.use("/api/extraction-protocols", createMasterDataRouter({
  collectionName: "extractionProtocols",
  idField: "protocolID",
  model: require("./src/models/ExtractionProtocol")
}));
app.use("/api/studies", createMasterDataRouter({
  collectionName: "studies",
  idField: "studyId",
  model: require("./src/models/Study")
}));
app.use("/api/protocols", createMasterDataRouter({
  collectionName: "protocols",
  idField: "protocolId",
  model: require("./src/models/Protocol")
}));
app.use("/api/collections", createMasterDataRouter({
  collectionName: "collections",
  idField: "collectionId",
  model: require("./src/models/Collection")
}));
app.use("/api/equipment", require("./src/interface/routes/equipment.routes"));
app.use("/api/organizations", require("./src/interface/routes/organization.routes"));
app.use("/api/storage", require("./src/interface/routes/storage.routes"));
app.use("/api/facilities", require("./src/interface/routes/facility.routes"));
app.use("/api/rooms", require("./src/interface/routes/room.routes"));
app.use("/api/policies", require("./src/interface/routes/policy.routes"));
app.use("/api/sensors", require("./src/interface/routes/sensor.routes"));
app.use("/api/iot", require("./src/interface/routes/iot.routes"));
app.use("/api/temperature", require("./src/interface/routes/temperature.routes"));
app.use("/api/incidents", require("./src/interface/routes/incident.routes"));
app.use("/api/e-consent", require("./src/routes/eConsent.js"));
app.use("/api/retention-policies", require("./src/routes/retentionPolicy.js"));
app.use("/api/intake-wizard", require("./src/interface/routes/intakeWizard.routes"));
app.use("/api/terminologies", require("./src/interface/routes/terminologies.routes"));
app.use("/api/users", require("./src/interface/routes/user.routes"));
app.use("/api/access", require("./src/interface/routes/access.routes"));
app.use("/api/security", require("./src/interface/routes/security.routes"));
app.use("/api/user/security", require("./src/interface/routes/user-security.routes"));
app.use("/api/backup", require("./src/interface/routes/backup.routes"));
app.use("/api/import-lgpd", require("./src/interface/routes/import-lgpd.routes"));
app.use("/api/compliance", require("./src/interface/routes/compliance.routes"));
app.use("/api/cids", require("./src/interface/routes/cid.routes"));

app.use("/api/phone-codes", require("./src/interface/routes/phone-codes.routes"));
app.use("/api/dictionary", require("./src/interface/routes/dictionary.routes"));

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", db: !!req.app.locals.db });
});

module.exports = app;
