// RBAC gate pins for accessRequest.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/accessRequest.js',
  mount: '/api/access-requests',
  pins: [
    { method: 'POST', path: '/', permission: 'manageAccessRequests' },
    { method: 'POST', path: '/:id/evaluate', permission: 'manageAccessRequests' },
    { method: 'POST', path: '/:id/decision', permission: 'manageAccessRequests' },
    { method: 'POST', path: '/:id/distribute', permission: 'manageAccessRequests' },
    { method: 'POST', path: '/:id/revoke', permission: 'manageAccessRequests' },
    { method: 'GET', path: '/:id/access-check', permission: 'manageAccessRequests' },
    { method: 'GET', path: '/:id', permission: 'manageAccessRequests' },
    { method: 'GET', path: '/', permission: 'manageAccessRequests' },
  ],
};
