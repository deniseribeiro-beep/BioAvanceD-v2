// RBAC gate pins for organization.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/organization.routes.js',
  mount: '/api/organizations',
  pins: [
    { method: 'POST', path: '/', permission: 'manageOrganizations' },
    { method: 'PUT', path: '/:id', permission: 'manageOrganizations' },
    { method: 'DELETE', path: '/:id', permission: 'manageOrganizations' },
  ],
};
