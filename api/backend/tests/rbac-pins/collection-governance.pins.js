// RBAC gate pins for collection-governance.routes.js (#1342). Format and
// proof: see incident.pins.js.
module.exports = {
  file: 'interface/routes/collection-governance.routes.js',
  mount: '/api/collections/:collectionId/governance',
  pins: [
    { method: 'POST', path: '/approvals', roles: [3, 4] },
    { method: 'POST', path: '/approvals/:approvalId/status', roles: [3, 4] },
    { method: 'POST', path: '/events', roles: [3, 4] },
  ],
};
