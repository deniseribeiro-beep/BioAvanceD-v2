// RBAC gate pins for workflow-run-file-link.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/workflow-run-file-link.routes.js',
  mount: '/api/workflow-runs/:workflowRunId/files',
  pins: [
    { method: 'POST', path: '/', roles: [3, 4] },
  ],
};
