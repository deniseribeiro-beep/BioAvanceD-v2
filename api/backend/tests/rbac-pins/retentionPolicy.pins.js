// RBAC gate pins for retentionPolicy.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/retentionPolicy.js',
  mount: '/api/retention-policies',
  pins: [
    { method: 'POST', path: '/', roles: [4] },
    { method: 'PUT', path: '/:id', roles: [4] },
    { method: 'GET', path: '/active', roles: [4] },
    { method: 'GET', path: '/data-classes', roles: [4] },
    { method: 'GET', path: '/:id', roles: [4] },
    { method: 'GET', path: '/', roles: [4] },
  ],
};
