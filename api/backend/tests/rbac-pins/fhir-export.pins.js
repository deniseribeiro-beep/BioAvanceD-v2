// RBAC gate pins for fhir-export.routes.js (#1322). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/fhir-export.routes.js',
  mount: '/api/export/fhir',
  pins: [
    { method: 'GET', path: '/workflow-runs/:workflowRunId/lineage', roles: [3, 4] },
    { method: 'GET', path: '/workflow-runs/:workflowRunId', roles: [3, 4] },
    { method: 'GET', path: '/studies/:studyId', roles: [3, 4] },
    { method: 'GET', path: '/audit-events/:eventId', permission: 'viewReports' },
  ],
};
