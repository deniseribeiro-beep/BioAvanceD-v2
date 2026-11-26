// RBAC gate pins for availability.routes.js (#1468). Format and proof:
// see incident.pins.js.
module.exports = {
  file: 'interface/routes/availability.routes.js',
  mount: '/api/availability',
  pins: [
    { method: 'POST', path: '/records', roles: [4] },
    { method: 'GET', path: '/records', roles: [4] },
    { method: 'GET', path: '/report', roles: [4] },
  ],
};
