// RBAC gate pins for accessPolicy.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/accessPolicy.js',
  mount: '/api/access-policies',
  pins: [
    { method: 'POST', path: '/', permission: 'manageAccessRequests' },
    { method: 'POST', path: '/:id/versions', permission: 'manageAccessRequests' },
    { method: 'GET', path: '/:id', permission: 'manageAccessRequests' },
    { method: 'GET', path: '/', permission: 'manageAccessRequests' },
  ],
};
