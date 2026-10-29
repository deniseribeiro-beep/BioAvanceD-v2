// RBAC gate pins for notification.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/notification.js',
  mount: '/api/notifications',
  pins: [
    { method: 'GET', path: '/', roles: [4] },
    { method: 'PUT', path: '/:id/confirm', roles: [4] },
  ],
};
