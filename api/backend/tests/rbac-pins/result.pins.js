// RBAC gate pins for result.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/result.routes.js',
  mount: '/api/results',
  pins: [
    { method: 'POST', path: '/upload', permission: 'uploadFiles' },
    { method: 'POST', path: '/', permission: 'createResult' },
    { method: 'PUT', path: '/:id', permission: 'editResult' },
    { method: 'PUT', path: '/:id/link-sample', permission: 'editResult' },
    { method: 'DELETE', path: '/:id', permission: 'deleteResult' },
  ],
};
