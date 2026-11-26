// RBAC gate pins for user.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/user.routes.js',
  mount: '/api/users',
  pins: [
    { method: 'POST', path: '/register', permission: 'createUser' },
    { method: 'POST', path: '/register', permission: 'assignRole' },
    { method: 'GET', path: '/', permission: 'readUser' },
    { method: 'GET', path: '/:id', permission: 'readUser' },
    { method: 'PUT', path: '/:id', permission: 'updateUser' },
    { method: 'DELETE', path: '/:id', permission: 'deleteUser' },
    { method: 'GET', path: '/:id/validate-status', permission: 'readUser' },
    // #1358: a user's organization scopes; granting or removing one is a
    // role assignment.
    { method: 'GET', path: '/:id/organizations', permission: 'readUser' },
    { method: 'POST', path: '/:id/organizations', permission: 'updateUser' },
    { method: 'POST', path: '/:id/organizations', permission: 'assignRole' },
    { method: 'DELETE', path: '/:id/organizations/:organizationId', permission: 'updateUser' },
    { method: 'DELETE', path: '/:id/organizations/:organizationId', permission: 'assignRole' },
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
