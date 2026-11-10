require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const logger = require("./src/utils/logger");
const env = require("./src/config/env");
const { skipAuthBudget } = require("./src/infrastructure/middleware/authLimiterSkip");
const dependencyHealth = require("./src/infrastructure/health/dependencyHealth");

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

// #1308: first, so every later middleware's log line and audit event carries
// the request's id (RNF020 C6, RF012 AC1's correlationId).
app.use(require("./src/utils/requestContext").middleware);
// RNF015 C1/C2 (#1323): before helmet, cors and the limiters, so their refusals count too.
app.use(require("./src/infrastructure/metrics/httpMetrics").middleware);

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
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
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
  // #1253: the public password-policy read verifies no secret; see authLimiterSkip.
  skip: skipAuthBudget,
});

// #823/#832: six routes on the e-consent router carry no `authenticate` --
// the emailed token IS the credential, so they are unauthenticated by design
// and verify a secret on every call. That is authLimiter's shape exactly, and
// until now they had only globalLimiter's shared 1000-per-15-min budget, which
// is a weak ceiling for walking an 8-digit participantId space. Same
// strict-by-default posture, on its own isolated flag (see env.js) rather than
// reusing AUTH_RATE_LIMIT_RELAXED: the two relax different controls, and a
// stack needing headroom on one does not thereby need it on the other.
const consentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (env.CONSENT_RATE_LIMIT_RELAXED && env.NODE_ENV !== "production") ? 100 : 10,
  message: "Muitas requisições. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// #1230: every limiter mounts AFTER auditRequest (above), deliberately, so a
// 429 is itself an audited request. RF012 records every AuditEvent with its
// result, and the binding principle bars configuration from disabling audit,
// so rows are neither aggregated nor skipped. Their volume is retention's
// job (RF026, #667). Pinned by rateLimitAudit.composition.test.js.
if (!isTest) {
  app.use(globalLimiter);
  app.use("/api/auth", authLimiter);
  // Scoped to the token-credential paths ONLY. The rest of /api/e-consent is
  // authenticate-gated operator surface (template and policy CRUD, the
  // pending-patients list) and must not share a participant-facing budget --
  // a coordinator doing bulk consent work would 429 on it.
  app.use("/api/e-consent/validate", consentLimiter);
  app.use("/api/e-consent/update", consentLimiter);
  app.use("/api/e-consent/consent-tokens", consentLimiter);
  app.use("/api/e-consent/import/fhir/consent", consentLimiter);
}

app.use("/api/auth", require("./src/interface/routes/auth.routes"));
app.use("/api/orphanet", require("./src/interface/routes/orphanet.routes"));
app.use("/api/hpo", require("./src/interface/routes/hpo.routes"));
app.use("/api/patients", require("./src/interface/routes/patient.routes"));
app.use("/api/v1/patients", require("./src/interface/routes/patient.routes"));
app.use("/api/samples", require("./src/interface/routes/sample.routes"));
app.use("/api/file-access", require("./src/interface/routes/file-access.routes"));
app.use("/api/quality", require("./src/interface/routes/quality.routes"));
app.use("/api/import", require("./src/interface/routes/import.routes"));
app.use("/api/results", require("./src/interface/routes/result.routes"));
app.use("/api/reports", require("./src/interface/routes/reports.routes"));
app.use("/api/report-templates", require("./src/interface/routes/reportTemplates.routes"));
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
// #881: retired the numeric qualityID idField. The canonical business
// identifier, settled by #902, is the string MIABIS code the seed writes
// on `id` -- src/reference-data/essential/manifest.js:12 declares
// uniqueKeys: ['id'] and the seed uses it verbatim as the upsert filter;
// every KEYED backend lookup
// resolves on `id` (import-lgpd.service.js:1376 findOne({ id }), plus
// master-data.routes.js:24's additive $or branch). idField is now 'id',
// and the numeric generateId override (Date.now()) is removed so the
// factory's randomUUID() default no longer matters here either --
// QualityDescription.js's create() now returns `id`, not a numeric key.
app.use("/api/quality-descriptions", createMasterDataRouter({
  collectionName: "qualityDescriptions",
  idField: "id",
  model: require("./src/models/QualityDescription")
}));
// #881: retired the numeric sampleTypeID idField. The canonical business
// identifier, settled by #902, is the string MIABIS code the seed writes
// on `id` -- src/reference-data/essential/manifest.js:12 declares
// uniqueKeys: ['id'] and the seed uses it verbatim as the upsert filter;
// every KEYED backend lookup
// resolves on `id` (import-lgpd.service.js:1376 findOne({ id }), plus
// master-data.routes.js:24's additive $or branch). idField is now 'id',
// and the numeric generateId override (Date.now()) is removed so the
// factory's randomUUID() default no longer matters here either --
// SampleType.js's create() now returns `id`, not a numeric key.
app.use("/api/sample-types", createMasterDataRouter({
  collectionName: "sampleTypes",
  idField: "id",
  model: require("./src/models/SampleType")
}));
// #881: retired the numeric originID idField. The canonical business
// identifier, settled by #902, is the string MIABIS code the seed writes
// on `id` -- src/reference-data/essential/manifest.js:12 declares
// uniqueKeys: ['id'] and the seed uses it verbatim as the upsert filter;
// every KEYED backend lookup
// resolves on `id` (import-lgpd.service.js:1376 findOne({ id }), plus
// master-data.routes.js:24's additive $or branch). idField is now 'id',
// and the numeric generateId override (Date.now()) is removed so the
// factory's randomUUID() default no longer matters here either --
// SampleOrigin.js's create() now returns `id`, not a numeric key.
app.use("/api/sample-origins", createMasterDataRouter({
  collectionName: "sampleOrigins",
  idField: "id",
  model: require("./src/models/SampleOrigin")
}));
// #881: retired the numeric protocolID idField. The canonical business
// identifier, settled by #902, is the string MIABIS code the seed writes
// on `id` -- src/reference-data/essential/manifest.js:12 declares
// uniqueKeys: ['id'] and the seed uses it verbatim as the upsert filter;
// every KEYED backend lookup
// resolves on `id` (import-lgpd.service.js:1376 findOne({ id }), plus
// master-data.routes.js:24's additive $or branch). idField is now 'id',
// and the numeric generateId override (Date.now()) is removed so the
// factory's randomUUID() default no longer matters here either --
// ExtractionProtocol.js's create() now returns `id`, not a numeric key.
app.use("/api/extraction-protocols", createMasterDataRouter({
  collectionName: "extractionProtocols",
  idField: "id",
  model: require("./src/models/ExtractionProtocol")
}));
// #1403: no scopeField on purpose: dict-02 gives Study no owning organization (ELM-0066 is 0..*); docs/decisions/2026-10-25-study-and-workflow-run-organization-scope.md.
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
// #665: Assay and ReagentLot ride createMasterDataRouter's shared
// requireRole(3, 4) write gate, so a Tecnico cannot POST either -- while
// POST /api/nonconformances (same RF025 slice) is deliberately
// requireRole(2, 3, 4). That asymmetry was investigated and the gate is
// LEFT AS IS. Recorded here so the next audit does not re-open it.
//
// RF025's "Ator primario: Tecnico" does not carry authorization weight
// anywhere in this repo: RF004, RF006 and RF016 all say the same thing and
// are implemented as requirePermission capabilities (sample.routes.js), not
// requireRole floors -- and RF002 AC#1, the one AC that describes what a
// Tecnico may do, says "operacoes AUTORIZADAS de cadastro", deferring to
// the authorization model rather than defining it. None of RF025's six ACs
// has a grammatical subject; they are impersonal infinitives, and none says
// who registers an Assay or a ReagentLot. dict-02 has no creator/owner
// column for any entity -- Assay.operatorId (ELM-0292) records who RAN the
// assay, which is data about the assay, not a statement about who may POST
// the record. And equipment.routes.js, cited in #665 as the precedent for
// a looser gate, is not one: it predates the factory by six days, was never
// migrated into it, and gates writes on requirePermission('createPatient'),
// which Tecnico does not hold -- so its effective create audience is the
// same Coordenador/Administrador tier.
//
// INFERENCE, not a citation: the consistent reading is that a Tecnico runs
// the assay (recorded as operatorId) while a Coordenador enters the
// master-data record -- an ordinary separation of duties. Cheap to
// overturn: createMasterDataRouter has no per-entity role override today,
// and adding a `writeRoles` option (defaulting to [3, 4]) would let these
// two mounts pass [2, 3, 4] without touching the other 12 entities.
app.use("/api/assays/:assayId/files", require("./src/interface/routes/assay-file.routes"));
app.use("/api/assays", createMasterDataRouter({
  collectionName: "assays",
  idField: "assayId",
  model: require("./src/models/Assay"),
  validateReferences: require("./src/services/assayReferenceValidator").validateAssayReferences,
  // #1182: Assay is the one mount with an organization field of its own.
  scopeField: "laboratoryId"
}));
app.use("/api/reagent-lots", createMasterDataRouter({
  collectionName: "reagentLots",
  idField: "reagentId",
  model: require("./src/models/ReagentLot")
}));
app.use("/api/nonconformances", require("./src/routes/nonconformance.js"));
app.use("/api/datasets/:datasetId/files", require("./src/interface/routes/dataset-file.routes"));
app.use("/api/datasets", createMasterDataRouter({
  collectionName: "datasets",
  idField: "datasetId",
  model: require("./src/models/Dataset")
}));
// RF004 AC3-AC5, RF020 AC2-AC4: approvals, the governance context and the
// events that set or convert it. Mounted before /api/collections.
app.use("/api/collections/:collectionId/governance", require("./src/interface/routes/collection-governance.routes"));
app.use("/api/collections", createMasterDataRouter({
  collectionName: "collections",
  idField: "collectionId",
  model: require("./src/models/Collection"),
  // RF020 AC4: a regime conversion needs an event and an approval, not an edit.
  immutableFields: ["governanceRegime"]
}));
// RF020 AC5-AC7 (#1322): the MIABIS export of Biobank and Collection, its
// national extensions and its round-trip loss report. Mounted before
// /api/biobanks so its GET /:id does not take the path.
app.use("/api/biobanks/miabis", require("./src/interface/routes/miabis-export.routes"));
// RF011 AC4 (#1322): a sample file as a FHIR DocumentReference, behind the sample-file FHIR export's gates.
app.use("/api/export/fhir/samples/:specimenId/files/:fileID", require("./src/interface/routes/fhir-document-reference-export.routes"));
// RF011 AC4 (#1322): a WorkflowRun, a Study and an audit event as FHIR Provenance, ResearchStudy and AuditEvent.
app.use("/api/export/fhir", require("./src/interface/routes/fhir-export.routes"));
// RF020 AC1 (#1322): Network and Biobank, entered by a Coordenador or
// Administrador; the MIABIS export reads them.
app.use("/api/biobanks", createMasterDataRouter({
  collectionName: "biobanks",
  idField: "biobankId",
  model: require("./src/models/Biobank"),
  validateReferences: require("./src/services/institutionalReferenceValidator").validateBiobankReferences
}));
app.use("/api/networks", createMasterDataRouter({
  collectionName: "networks",
  idField: "networkId",
  model: require("./src/models/Network"),
  validateReferences: require("./src/services/institutionalReferenceValidator").validateNetworkReferences
}));
// RNF008 AC3 (#1496): ResearchResource and its links to a Collection and a
// Biobank, the dictionary's only path from a collection to its biobank.
app.use("/api/research-resources", createMasterDataRouter({
  collectionName: "researchResources",
  idField: "researchResourceId",
  model: require("./src/models/ResearchResource")
}));
app.use("/api/research-resource-collections", createMasterDataRouter({
  collectionName: "researchResourceCollections",
  idField: "associationId",
  model: require("./src/models/ResearchResourceCollection"),
  validateReferences: require("./src/services/institutionalReferenceValidator").validateResearchResourceCollectionReferences
}));
app.use("/api/research-resource-biobanks", createMasterDataRouter({
  collectionName: "researchResourceBiobanks",
  idField: "associationId",
  model: require("./src/models/ResearchResourceBiobank"),
  validateReferences: require("./src/services/institutionalReferenceValidator").validateResearchResourceBiobankReferences
}));
// ELM-0275..0285 (#1206): BiomarkerAssociation reference data, entered by a
// Coordenador or Administrador; each association names its evidence (1..*).
app.use("/api/biomarker-associations", createMasterDataRouter({
  collectionName: "biomarkerAssociations",
  idField: "biomarkerId",
  model: require("./src/models/BiomarkerAssociation"),
  validateReferences: require("./src/services/biomarkerAssociation.service").validateBiomarkerAssociationReferences
}));
// RF011 AC3, RNF024 C2, RULE-036 (#1322): the identifier namespaces a
// Coordenador or Administrador enters; the FHIR import validation reads
// them for identifier.system. A namespaceKey keeps its systemUri.
app.use("/api/identifier-namespaces", createMasterDataRouter({
  collectionName: "identifierNamespaceRegistries",
  idField: "identifierNamespaceRegistryId",
  model: require("./src/models/IdentifierNamespaceRegistry"),
  validateReferences: require("./src/services/identifierNamespaceRegistry.service").validateNamespaceReferences,
  immutableFields: ["namespaceKey", "systemUri"]
}));
// RF011 AC2 (#1322): mapping releases; a new mappingVersion is a new row naming the old one in supersedesReleaseId.
app.use("/api/interoperability-mapping-releases", createMasterDataRouter({
  collectionName: "interoperabilityMappingReleases",
  idField: "interoperabilityMappingReleaseId",
  model: require("./src/models/InteroperabilityMappingRelease"),
  validateReferences: require("./src/services/interoperabilityMappingRelease.service").validateMappingReleaseReferences,
  immutableFields: ["mappingVersion"]
}));
// RF011 AC2 (#1322): FHIR profiles under a stored release; the FHIR import validation reads them for meta.profile.
app.use("/api/fhir-profiles", createMasterDataRouter({
  collectionName: "fhirProfileRegistries",
  idField: "fhirProfileRegistryId",
  model: require("./src/models/FHIRProfileRegistry"),
  validateReferences: require("./src/services/interoperabilityMappingRelease.service").validateProfileReferences,
  immutableFields: ["canonicalUrl", "profileVersion"]
}));
app.use("/api/workflow-runs/:workflowRunId/files", require("./src/interface/routes/workflow-run-file-link.routes"));
app.use("/api/workflow-runs/:workflowRunId/lineage", require("./src/interface/routes/workflow-run-lineage.routes"));
// #1403: no scopeField on purpose: dict-02 gives WorkflowRun no organization field (ELM-0326..0336, V2E-0477..0480); docs/decisions/2026-10-25-study-and-workflow-run-organization-scope.md.
app.use("/api/workflow-runs", createMasterDataRouter({
  collectionName: "workflowRuns",
  idField: "workflowRunId",
  model: require("./src/models/WorkflowRun"),
  // RF027 AC6 (#1322): resumesWorkflowRunId names a stored failed run on create, never edited.
  validateReferences: require("./src/services/workflowRun.service").validateWorkflowRunReferences
}));
app.use("/api/omics-qualifications", createMasterDataRouter({
  collectionName: "omicsQualifications",
  idField: "omicsQualificationId",
  model: require("./src/models/OmicsQualification")
}));
app.use("/api/omics-runs", createMasterDataRouter({
  collectionName: "omicsRuns",
  idField: "omicsRunId",
  model: require("./src/models/OmicsRun")
}));
// ImagingDerivedData, segmentation and feature sets (ELM-0355/0356, #721).
app.use("/api/imaging-derived-data", createMasterDataRouter({
  collectionName: "imagingDerivedData",
  idField: "imagingDerivedDataId",
  model: require("./src/models/ImagingDerivedData")
}));
// ImagingStudy, DICOM study and series metadata (ELM-0353/0354, #721).
app.use("/api/imaging-studies", createMasterDataRouter({
  collectionName: "imagingStudies",
  idField: "imagingStudyId",
  model: require("./src/models/ImagingStudy")
}));
app.use("/api/diagnostic-reports", require("./src/interface/routes/diagnostic-report.routes"));
app.use("/api/equipment", require("./src/interface/routes/equipment.routes"));
app.use("/api/organizations", require("./src/interface/routes/organization.routes"));
app.use("/api/storage", require("./src/interface/routes/storage.routes"));
app.use("/api/physical-chain", require("./src/interface/routes/physical-chain.routes"));
app.use("/api/devices", require("./src/interface/routes/device.routes"));
app.use("/api/device-registrations", require("./src/interface/routes/deviceRegistration.routes"));
app.use("/api/telemetry-datastreams", require("./src/interface/routes/telemetryDatastream.routes"));
app.use("/api/policies", require("./src/interface/routes/policy.routes"));
app.use("/api/sensors", require("./src/interface/routes/sensor.routes"));
app.use("/api/iot", require("./src/interface/routes/iot.routes"));
// RF029 slice 1/6 (#669): test-support-only ingestion gateway probe, same
// NODE_ENV+shared-secret gating as iot.routes.js's telemetry-monitor routes.
app.use("/api/_test-support/ingestion", require("./src/interface/routes/ingestionTestSupport.routes"));
// RF028/RNF032 (#1476): test-support-only reference import into an E2E_
// dataset, under the same gates, so the e2e suite can promote and roll back.
app.use("/api/_test-support/reference-import-runs",require("./src/interface/routes/referenceImportsTestSupport.routes"));
// RF022/RNF031 (#1485): test-support-only Foundation job run on a scratch
// database, under the same gates, so the e2e suite can roll back and fail a gate.
app.use("/api/_test-support/foundation-runs", require("./src/interface/routes/foundationRunsTestSupport.routes"));
// RF023/RNF019 (#1502): test-support-only scoped reconciliation, under the same
// gates, so the e2e suite can delete a Sample node and see it replayed from the outbox.
app.use("/api/_test-support/graph-projection", require("./src/interface/routes/graphProjectionTestSupport.routes"));
// RF029 (#1318): the production ingestion route; it persists and audits.
app.use("/api/ingestion", require("./src/interface/routes/ingestion.routes"));
app.use("/api/temperature", require("./src/interface/routes/temperature.routes"));
app.use("/api/incidents", require("./src/interface/routes/incident.routes"));
app.use("/api/e-consent", require("./src/routes/eConsent.js"));
app.use("/api/retention-policies", require("./src/routes/retentionPolicy.js"));
app.use("/api/legal-holds", require("./src/routes/legalHold.js"));
app.use("/api/disposition-actions", require("./src/routes/dispositionAction.js"));
app.use("/api/shipments", require("./src/routes/shipment.js"));
app.use("/api/access-requests", require("./src/routes/accessRequest.js"));
app.use("/api/access-policies", require("./src/routes/accessPolicy.js"));
app.use("/api/reference-releases", require("./src/interface/routes/referenceRelease.routes"));
app.use("/api/monitoring", require("./src/interface/routes/monitoring.routes"));
app.use("/api/notification-rules", require("./src/routes/notificationRule.js"));
app.use("/api/notifications", require("./src/routes/notification.js"));
app.use("/api/intake-wizard", require("./src/interface/routes/intakeWizard.routes"));
app.use("/api/terminologies", require("./src/interface/routes/terminologies.routes"));
app.use("/api/users", require("./src/interface/routes/user.routes"));
app.use("/api/access", require("./src/interface/routes/access.routes"));
app.use("/api/security", require("./src/interface/routes/security.routes"));
app.use("/api/user/security", require("./src/interface/routes/user-security.routes"));
app.use("/api/backup", require("./src/interface/routes/backup.routes"));
app.use("/api/backup-policy", require("./src/interface/routes/backupPolicy.routes"));
app.use("/api/import-lgpd", require("./src/interface/routes/import-lgpd.routes"));
app.use("/api/compliance", require("./src/interface/routes/compliance.routes"));
app.use("/api/cids", require("./src/interface/routes/cid.routes"));

app.use("/api/phone-codes", require("./src/interface/routes/phone-codes.routes"));
app.use("/api/dictionary", require("./src/interface/routes/dictionary.routes"));

// RNF003 AC3 (#1323): 503 only when a check the server cannot serve without is
// down -- MongoDB always, Neo4j only under fail-closed/NEO4J_REQUIRED, matching
// the boot posture. Redis and InfluxDB down give degraded: true under 200, so a
// compose healthcheck never restarts the backend over them (#977).
app.get("/api/health", async (req, res) => {
  const report = await dependencyHealth.checkDependencies(dependencyHealth.inputsFrom(req.app));
  res.status(report.critical ? 503 : 200).json({
    status: report.critical ? "UNAVAILABLE" : "OK",
    db: report.checks.mongodb.status === "up",
    degraded: report.degraded,
    checks: report.checks,
  });
});

module.exports = app;
