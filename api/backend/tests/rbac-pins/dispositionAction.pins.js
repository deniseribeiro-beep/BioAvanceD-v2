// RBAC gate pins for dispositionAction.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/dispositionAction.js',
  mount: '/api/disposition-actions',
  pins: [
    { method: 'POST', path: '/', roles: [3, 4] },
    { method: 'POST', path: '/:id/approve', roles: [4] },
    { method: 'POST', path: '/:id/execute', roles: [3, 4] },
    { method: 'POST', path: '/:id/cancel', roles: [3, 4] },
  ],
};
