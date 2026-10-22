// RBAC gate pins for referenceRelease.routes.js (#1319). Format and proof:
// see incident.pins.js.
module.exports = {
  file: 'interface/routes/referenceRelease.routes.js',
  mount: '/api/reference-releases',
  pins: [
    { method: 'POST', path: '/:id/promote', roles: [4] },
    { method: 'POST', path: '/datasets/:datasetCode/rollback', roles: [4] },
  ],
};
