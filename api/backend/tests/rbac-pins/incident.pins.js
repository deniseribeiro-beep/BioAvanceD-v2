// RBAC gate pins for incident.routes.js (#1342). Each row states the gate a
// route must carry. rbac-gate-pins.test.js proves every row against the real
// middleware, and rbac-pinned-sites.arch.test.js checks that every row matches
// a gate the route file declares.
module.exports = {
  file: 'interface/routes/incident.routes.js',
  mount: '/api/incidents',
  pins: [
    { method: 'GET', path: '/', permission: 'viewTemperature' },
    { method: 'PUT', path: '/:incidentId/acknowledge', permission: 'manageTemperature' },
    { method: 'PUT', path: '/:incidentId/resolve', permission: 'manageTemperature' },
    { method: 'PUT', path: '/:incidentId/escalate', permission: 'manageTemperature' },
    { method: 'POST', path: '/:incidentId/notes', permission: 'viewTemperature' },
  ],
};
