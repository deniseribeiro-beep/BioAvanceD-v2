// RBAC gate pins for access.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/access.routes.js',
  mount: '/api/access',
  pins: [
    { method: 'GET', path: '/', permission: 'createUser' },
    { method: 'GET', path: '/:id', permission: 'createUser' },
    { method: 'POST', path: '/', permission: 'createUser' },
    { method: 'PUT', path: '/:id', permission: 'createUser' },
    { method: 'DELETE', path: '/:id', permission: 'createUser' },
  ],
};
