/**
 * HISTORICAL — retired as design authority (#1055).
 *
 * The Foundation Data Pipeline
 * (`api/backend/scripts/run-foundation-data-pipeline.js`) superseded this
 * script for canonical collections and indexes. Do not treat this file as
 * the schema source of truth; npm run create-db now invokes the foundation
 * pipeline directly.
 *
 * Previously this entry point only re-exported the foundation pipeline:
 *   const { main } = require('../../api/backend/scripts/run-foundation-data-pipeline');
 */

throw new Error(
  'create-db.js is historical (#1055). Use: npm run create-db (foundation pipeline) or node api/backend/scripts/run-foundation-data-pipeline.js'
);
