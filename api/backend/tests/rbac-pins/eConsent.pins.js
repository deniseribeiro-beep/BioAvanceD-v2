// RBAC gate pins for eConsent.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/eConsent.js',
  mount: '/api/e-consent',
  pins: [
    { method: 'POST', path: '/generate-link', permission: 'requestConsent' },
    { method: 'GET', path: '/consent-policies/:id/pending-patients', roles: [3, 4] },
    { method: 'POST', path: '/consent-templates', roles: [3, 4] },
    { method: 'GET', path: '/consent-templates', roles: [3, 4] },
    { method: 'GET', path: '/purpose-codes', roles: [3, 4] },
    { method: 'GET', path: '/consent-templates/:id', roles: [3, 4] },
    { method: 'PUT', path: '/consent-templates/:id', roles: [3, 4] },
    { method: 'POST', path: '/consent-policies', roles: [3, 4] },
    { method: 'PUT', path: '/consent-policies/:id', roles: [3, 4] },
    { method: 'GET', path: '/consent-policies/history', roles: [3, 4] },
    { method: 'GET', path: '/consent-policies', roles: [3, 4] },
    { method: 'POST', path: '/consents', roles: [3, 4] },
    { method: 'POST', path: '/consents/:id/revoke', roles: [3, 4] },
    { method: 'GET', path: '/consents/:id/history', roles: [3, 4] },
    { method: 'GET', path: '/consents/:id/signed-tcle', roles: [3, 4] },
  ],
};
