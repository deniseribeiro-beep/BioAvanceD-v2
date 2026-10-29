// RBAC gate pins for legalHold.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/legalHold.js',
  mount: '/api/legal-holds',
  pins: [
    { method: 'POST', path: '/', roles: [3, 4] },
    { method: 'POST', path: '/:id/release', roles: [3, 4] },
  ],
};
