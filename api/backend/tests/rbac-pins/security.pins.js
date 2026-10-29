// RBAC gate pins for security.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/security.routes.js',
  mount: '/api/security',
  pins: [
    { use: true, roles: [4], probe: { method: 'GET', path: '/config' } },
  ],
};
