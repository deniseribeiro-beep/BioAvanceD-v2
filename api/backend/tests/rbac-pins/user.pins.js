// RBAC gate pins for user.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/user.routes.js',
  mount: '/api/users',
  pins: [
    { method: 'POST', path: '/register', permission: 'createUser' },
    { method: 'POST', path: '/register', permission: 'assignRole' },
    { method: 'GET', path: '/', permission: 'createUser' },
    { method: 'GET', path: '/:id', permission: 'createUser' },
    { method: 'PUT', path: '/:id', permission: 'createUser' },
    { method: 'DELETE', path: '/:id', permission: 'createUser' },
    { method: 'GET', path: '/:id/validate-status', permission: 'createUser' },
    { method: 'POST', path: '/register-patient', permission: 'createPatient' },
    { method: 'POST', path: '/register-sample', permission: 'createSample' },
    { method: 'POST', path: '/record-withdrawal', permission: 'withdrawSample' },
    { method: 'POST', path: '/generate-report', permission: 'viewReports' },
    { method: 'POST', path: '/register-sensor', permission: 'manageSensor' },
    { method: 'POST', path: '/:id/reset-mfa', permission: 'resetMFA' },
    { method: 'POST', path: '/:id/revoke-sessions', permission: 'revokeSessions' },
    { method: 'POST', path: '/:id/force-password-reset', permission: 'forcePasswordReset' },
    { method: 'POST', path: '/:id/set-password', permission: 'setUserPassword' },
    { method: 'POST', path: '/:id/disable-mfa', permission: 'disableMFA' },
  ],
};
