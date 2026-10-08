// RBAC gate pins for master-data.routes.js (#1342). Format and proof: see
// incident.pins.js. app.js mounts this router factory several times; the
// table pins it through one of its mounts.
module.exports = {
  file: 'interface/routes/master-data.routes.js',
  mount: '/api/measurement-units',
  pins: [
    { method: 'POST', path: '/', roles: [3, 4] },
    { method: 'PUT', path: '/:id', roles: [3, 4] },
    { method: 'DELETE', path: '/:id', roles: [3, 4] },
  ],
};
