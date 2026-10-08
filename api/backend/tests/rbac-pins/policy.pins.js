// RBAC gate pins for policy.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/policy.routes.js',
  mount: '/api/policies',
  pins: [
    { method: 'GET', path: '/', permission: 'viewTemperature' },
    { method: 'GET', path: '/:id', permission: 'viewTemperature' },
    { method: 'GET', path: '/:id/active-limit', permission: 'viewTemperature' },
    { method: 'POST', path: '/', permission: 'manageTemperaturePolicy' },
    { method: 'PUT', path: '/:id', permission: 'manageTemperaturePolicy' },
    { method: 'DELETE', path: '/:id', permission: 'manageTemperaturePolicy' },
  ],
};
