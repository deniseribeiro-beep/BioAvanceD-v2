// RBAC gate pins for access.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/access.routes.js',
  mount: '/api/access',
  pins: [
    { method: 'GET', path: '/', permission: 'manageAccessGrants' },
    { method: 'GET', path: '/:id', permission: 'manageAccessGrants' },
    { method: 'POST', path: '/', permission: 'manageAccessGrants' },
    { method: 'PUT', path: '/:id', permission: 'manageAccessGrants' },
    { method: 'DELETE', path: '/:id', permission: 'manageAccessGrants' },
  ],
};
