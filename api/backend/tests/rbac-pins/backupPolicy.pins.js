// RBAC gate pins for backupPolicy.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/backupPolicy.routes.js',
  mount: '/api/backup-policy',
  pins: [
    { use: true, roles: [4], probe: { method: 'GET', path: '/' } },
  ],
};
