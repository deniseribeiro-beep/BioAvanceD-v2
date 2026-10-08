// RBAC gate pins for nonconformance.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/nonconformance.js',
  mount: '/api/nonconformances',
  pins: [
    { method: 'POST', path: '/', roles: [2, 3, 4] },
    { method: 'POST', path: '/:id/corrective-action', roles: [3, 4] },
    { method: 'POST', path: '/:id/verify-effectiveness', roles: [3, 4] },
  ],
};
