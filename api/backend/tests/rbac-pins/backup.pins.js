// RBAC gate pins for backup.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/backup.routes.js',
  mount: '/api/backup',
  pins: [
    { use: true, permission: 'manageBackup', probe: { method: 'GET', path: '/list' } },
  ],
};
