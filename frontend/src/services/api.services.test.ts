import { afterEach, describe, expect, it, vi } from 'vitest';
import api, {
  accessRequestService,
  accessService,
  analysisFileService,
  analysisTypeService,
  auditService,
  authService,
  backupPolicyService,
  backupService,
  biomarkerAssociationService,
  cidService,
  collectionGovernanceService,
  collectionsService,
  consentService,
  consentTokenService,
  dataImportService,
  eConsentService,
  equipmentService,
  extractionProtocolService,
  importLGPDService,
  importService,
  logService,
  measurementUnitService,
  organizationService,
  patientService,
  phoneCodeService,
  policyService,
  qualityDescriptionService,
  reportTemplateService,
  reportsService,
  resultService,
  sampleOriginService,
  sampleService,
  sampleTypeService,
  securityService,
  sensorService,
  temperatureService,
  userSecurityService,
  userService,
} from './api';

// #1337: each service method sends one request on the shared client; these
// pin the verb, the route and the body or options a caller's arguments become.
type Verb = 'get' | 'post' | 'put' | 'delete';
type Row = [name: string, call: () => unknown, verb: Verb, args: unknown[]];

const fd = new FormData();
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

const rows: Row[] = [
  // patients
  ['patientService.getAll', () => patientService.getAll({ limit: 5 }), 'get', ['/patients', { params: { limit: 5 } }]],
  ['patientService.getById', () => patientService.getById(7), 'get', ['/patients/7']],
  ['patientService.create', () => patientService.create({ patientName: 'A' } as any), 'post', ['/patients', { patientName: 'A' }]],
  ['patientService.update', () => patientService.update(7, { patientName: 'B' } as any), 'put', ['/patients/7', { patientName: 'B' }]],
  ['patientService.delete', () => patientService.delete(7), 'delete', ['/patients/7']],
  ['patientService.validateID', () => patientService.validateID('P1'), 'post', ['/patients/validate-id', { participantId: 'P1' }]],
  ['patientService.findForEdit', () => patientService.findForEdit('P1'), 'post', ['/patients/find-for-edit', { participantId: 'P1' }]],
  ['patientService.search', () => patientService.search('a b&c'), 'get', ['/patients/search?q=a%20b%26c']],
  ['patientService.resendConsentNotification', () => patientService.resendConsentNotification('P1'), 'post', ['/patients/P1/consent/resend']],
  ['cidService.search defaults', () => cidService.search('flu'), 'get', ['/cids/search', { params: { q: 'flu', limit: 10, page: 1 } }]],
  ['cidService.search paged', () => cidService.search('flu', 50, 3), 'get', ['/cids/search', { params: { q: 'flu', limit: 50, page: 3 } }]],
  ['phoneCodeService.search defaults', () => phoneCodeService.search('55'), 'get', ['/phone-codes/search', { params: { q: '55', limit: 20 } }]],
  ['phoneCodeService.search limit', () => phoneCodeService.search('55', 3), 'get', ['/phone-codes/search', { params: { q: '55', limit: 3 } }]],
  // samples
  ['sampleService.getAll', () => sampleService.getAll(), 'get', ['/samples']],
  ['sampleService.getById', () => sampleService.getById(3), 'get', ['/samples/3']],
  ['sampleService.getComplianceGraph', () => sampleService.getComplianceGraph('S1'), 'get', ['/samples/S1/compliance-graph']],
  ['sampleService.getByBarcode', () => sampleService.getByBarcode('A/1'), 'get', ['/samples/by-barcode/A%2F1']],
  ['sampleService.getResults', () => sampleService.getResults(3), 'get', ['/samples/3/results']],
  ['sampleService.getMovements', () => sampleService.getMovements('S1'), 'get', ['/samples/S1/movements']],
  ['sampleService.create', () => sampleService.create({ barcode: 'B' } as any), 'post', ['/samples', { barcode: 'B' }]],
  ['sampleService.update', () => sampleService.update('S1', { barcode: 'C' } as any), 'put', ['/samples/S1', { barcode: 'C' }]],
  ['sampleService.releaseQuarantine', () => sampleService.releaseQuarantine('S1', { evidenceIds: ['e1'], reason: 'ok' }), 'post', ['/samples/S1/quarantine/release', { evidenceIds: ['e1'], reason: 'ok' }]],
  ['sampleService.close', () => sampleService.close('S1'), 'post', ['/samples/S1/close', {}]],
  ['sampleService.delete', () => sampleService.delete('S1'), 'delete', ['/samples/S1']],
  ['sampleService.withdraw', () => sampleService.withdraw('S1', { quantity: 1 } as any), 'post', ['/samples/S1/withdraw', { quantity: 1 }]],
  ['sampleService.return', () => sampleService.return('S1', { quantity: 1 } as any), 'post', ['/samples/S1/return', { quantity: 1 }]],
  ['sampleService.uploadFile', () => sampleService.uploadFile('S1', fd), 'post', ['/samples/S1/files/upload', fd, multipart]],
  ['sampleService.listFiles', () => sampleService.listFiles('S1'), 'get', ['/samples/S1/files']],
  ['sampleService.downloadFile', () => sampleService.downloadFile('S1', 'F1'), 'get', ['/samples/S1/files/F1/download', { responseType: 'blob' }]],
  ['sampleService.deleteFile', () => sampleService.deleteFile('S1', 'F1'), 'delete', ['/samples/S1/files/F1']],
  ['sampleService.exportHL7v2', () => sampleService.exportHL7v2('S1', 'F1'), 'get', ['/samples/S1/files/F1/export/hl7', { responseType: 'text' }]],
  ['sampleService.exportFHIR', () => sampleService.exportFHIR('S1', 'F1'), 'get', ['/samples/S1/files/F1/export/fhir']],
  ['sampleService.exportCDA', () => sampleService.exportCDA('S1', 'F1'), 'get', ['/samples/S1/files/F1/export/cda', { responseType: 'text' }]],
  // FHIR import
  ['dataImportService.stageFhirBundle', () => dataImportService.stageFhirBundle({ a: 1 }), 'post', ['/import/fhir/stage', { a: 1 }]],
  ['dataImportService.getFhirBatch', () => dataImportService.getFhirBatch('b 1'), 'get', ['/import/fhir/batches/b%201']],
  ['dataImportService.validateFhirBatch', () => dataImportService.validateFhirBatch('b1'), 'post', ['/import/fhir/batches/b1/validate']],
  ['dataImportService.sendFhirBatchConsents', () => dataImportService.sendFhirBatchConsents('b1'), 'post', ['/import/fhir/batches/b1/send-consents']],
  ['dataImportService.getFhirBatchConsentStatus', () => dataImportService.getFhirBatchConsentStatus('b1'), 'get', ['/import/fhir/batches/b1/consent-status']],
  ['dataImportService.commitFhirBatch', () => dataImportService.commitFhirBatch('b1'), 'post', ['/import/fhir/batches/b1/commit']],
  ['dataImportService.attachFhirExternalDocument', () => dataImportService.attachFhirExternalDocument('b1', 'r/1', 'n'), 'post', ['/import/fhir/batches/b1/records/r%2F1/external-document', { note: 'n' }]],
  // results
  ['resultService.getAll with a job', () => resultService.getAll('J1'), 'get', ['/results', { params: { importJobID: 'J1' } }]],
  ['resultService.getAll without a job', () => resultService.getAll(), 'get', ['/results', { params: undefined }]],
  ['resultService.getById', () => resultService.getById(4), 'get', ['/results/4']],
  ['resultService.upload', () => resultService.upload(fd), 'post', ['/results/upload', fd, multipart]],
  ['resultService.create', () => resultService.create({ value: 1 } as any), 'post', ['/results', { value: 1 }]],
  ['resultService.linkSample', () => resultService.linkSample(4, 'SP1'), 'put', ['/results/4/link-sample', { specimenId: 'SP1' }]],
  ['resultService.update', () => resultService.update(4, { value: 2 } as any), 'put', ['/results/4', { value: 2 }]],
  ['resultService.delete', () => resultService.delete(4), 'delete', ['/results/4']],
  ['analysisFileService.validateSample', () => analysisFileService.validateSample('S1'), 'get', ['/analysis-files/validate/S1']],
  // equipment, temperature, sensors, policies
  ['equipmentService.getAll', () => equipmentService.getAll(), 'get', ['/equipment']],
  ['equipmentService.getById', () => equipmentService.getById(2), 'get', ['/equipment/2']],
  ['equipmentService.getAnalytical', () => equipmentService.getAnalytical(), 'get', ['/equipment/analytical']],
  ['equipmentService.create', () => equipmentService.create({ name: 'E' } as any), 'post', ['/equipment', { name: 'E' }]],
  ['equipmentService.update', () => equipmentService.update(2, { name: 'F' } as any), 'put', ['/equipment/2', { name: 'F' }]],
  ['equipmentService.delete', () => equipmentService.delete(2), 'delete', ['/equipment/2']],
  ['temperatureService.getAll', () => temperatureService.getAll(), 'get', ['/temperature']],
  ['temperatureService.getById', () => temperatureService.getById('r/1'), 'get', ['/temperature/r%2F1']],
  ['sensorService.getAll', () => sensorService.getAll(), 'get', ['/sensors']],
  ['sensorService.getById', () => sensorService.getById('s1'), 'get', ['/sensors/s1']],
  ['sensorService.create', () => sensorService.create({ name: 'S' } as any), 'post', ['/sensors', { name: 'S' }]],
  ['sensorService.update', () => sensorService.update('s1', { name: 'T' } as any), 'put', ['/sensors/s1', { name: 'T' }]],
  ['sensorService.delete', () => sensorService.delete('s1'), 'delete', ['/sensors/s1']],
  ['policyService.getAll', () => policyService.getAll(), 'get', ['/policies']],
  ['policyService.getById', () => policyService.getById('p1'), 'get', ['/policies/p1']],
  ['policyService.getActiveLimit default max', () => policyService.getActiveLimit('p1'), 'get', ['/policies/p1/active-limit', { params: { type: 'max' } }]],
  ['policyService.getActiveLimit min', () => policyService.getActiveLimit('p1', false), 'get', ['/policies/p1/active-limit', { params: { type: 'min' } }]],
  ['policyService.create', () => policyService.create({ name: 'P' } as any), 'post', ['/policies', { name: 'P' }]],
  ['policyService.update', () => policyService.update('p1', { name: 'Q' } as any), 'put', ['/policies/p1', { name: 'Q' }]],
  ['policyService.delete', () => policyService.delete('p1'), 'delete', ['/policies/p1']],
  // users
  ['userService.getAll', () => userService.getAll(), 'get', ['/users']],
  ['userService.getById', () => userService.getById(1), 'get', ['/users/1']],
  ['userService.register', () => userService.register({ username: 'u' } as any), 'post', ['/users/register', { username: 'u' }]],
  ['userService.validateStatus', () => userService.validateStatus(1), 'get', ['/users/1/validate-status']],
  ['userService.registerPatient', () => userService.registerPatient({ patientName: 'A' } as any), 'post', ['/users/register-patient', { patientName: 'A' }]],
  ['userService.registerSample', () => userService.registerSample({ barcode: 'B' } as any), 'post', ['/users/register-sample', { barcode: 'B' }]],
  ['userService.recordWithdrawal', () => userService.recordWithdrawal({ quantity: 1 } as any), 'post', ['/users/record-withdrawal', { quantity: 1 }]],
  ['userService.generateReport', () => userService.generateReport('stock'), 'post', ['/users/generate-report', { reportType: 'stock' }]],
  ['userService.registerSensor', () => userService.registerSensor({ name: 'S' } as any), 'post', ['/users/register-sensor', { name: 'S' }]],
  ['userService.getLogs', () => userService.getLogs({ page: 2 }), 'get', ['/users/logs', { params: { page: 2 } }]],
  ['userService.update', () => userService.update(1, { username: 'v' } as any), 'put', ['/users/1', { username: 'v' }]],
  ['userService.delete', () => userService.delete(1), 'delete', ['/users/1']],
  ['userService.resetMFA', () => userService.resetMFA(1), 'post', ['/users/1/reset-mfa']],
  ['userService.disableMFA', () => userService.disableMFA(1), 'post', ['/users/1/disable-mfa']],
  ['userService.forcePasswordReset', () => userService.forcePasswordReset(1), 'post', ['/users/1/force-password-reset']],
  ['userService.setPassword', () => userService.setPassword(1, 'pw'), 'post', ['/users/1/set-password', { password: 'pw' }]],
  ['userService.revokeSessions', () => userService.revokeSessions(1, 'risk'), 'post', ['/users/1/revoke-sessions', { reason: 'risk' }]],
  ['userService.getOrganizationScopes', () => userService.getOrganizationScopes(1), 'get', ['/users/1/organizations']],
  ['userService.addOrganizationScope', () => userService.addOrganizationScope(1, 'o1'), 'post', ['/users/1/organizations', { organizationId: 'o1' }]],
  ['userService.removeOrganizationScope', () => userService.removeOrganizationScope(1, 'o/1'), 'delete', ['/users/1/organizations/o%2F1']],
  // organizations, report templates, collections, governance
  ['organizationService.getAll', () => organizationService.getAll({ limit: 500 }), 'get', ['/organizations', { params: { limit: 500 } }]],
  ['organizationService.getMine', () => organizationService.getMine(), 'get', ['/organizations/mine']],
  ['organizationService.create', () => organizationService.create({ officialName: 'O' } as any), 'post', ['/organizations', { officialName: 'O' }]],
  ['organizationService.update', () => organizationService.update('o1', { officialName: 'P' } as any), 'put', ['/organizations/o1', { officialName: 'P' }]],
  ['organizationService.delete', () => organizationService.delete('o1'), 'delete', ['/organizations/o1']],
  ['reportTemplateService.getAll', () => reportTemplateService.getAll(), 'get', ['/report-templates']],
  ['reportTemplateService.getOne', () => reportTemplateService.getOne('t1'), 'get', ['/report-templates/t1']],
  ['reportTemplateService.create', () => reportTemplateService.create({ name: 'T' } as any), 'post', ['/report-templates', { name: 'T' }]],
  ['reportTemplateService.update', () => reportTemplateService.update('t1', { name: 'U' } as any), 'put', ['/report-templates/t1', { name: 'U' }]],
  ['reportTemplateService.delete', () => reportTemplateService.delete('t1'), 'delete', ['/report-templates/t1']],
  ['collectionsService.getAll', () => collectionsService.getAll(), 'get', ['/collections']],
  ['collectionsService.getById', () => collectionsService.getById('c1'), 'get', ['/collections/c1']],
  ['collectionsService.create', () => collectionsService.create({ name: 'C' } as any), 'post', ['/collections', { name: 'C' }]],
  ['collectionsService.update', () => collectionsService.update('c1', { name: 'D' } as any), 'put', ['/collections/c1', { name: 'D' }]],
  ['collectionsService.delete', () => collectionsService.delete('c1'), 'delete', ['/collections/c1']],
  ['collectionGovernanceService.get', () => collectionGovernanceService.get('c/1'), 'get', ['/collections/c%2F1/governance']],
  ['collectionGovernanceService.createApproval', () => collectionGovernanceService.createApproval('c1', { a: 1 }), 'post', ['/collections/c1/governance/approvals', { a: 1 }]],
  ['collectionGovernanceService.setApprovalStatus', () => collectionGovernanceService.setApprovalStatus('c1', 'a/1', { status: 'approved' }), 'post', ['/collections/c1/governance/approvals/a%2F1/status', { status: 'approved' }]],
  ['collectionGovernanceService.recordEvent', () => collectionGovernanceService.recordEvent('c1', { e: 1 }), 'post', ['/collections/c1/governance/events', { e: 1 }]],
  // access requests and access
  ['accessRequestService.getAll', () => accessRequestService.getAll(), 'get', ['/access-requests']],
  ['accessRequestService.getById', () => accessRequestService.getById('r/1'), 'get', ['/access-requests/r%2F1']],
  ['accessRequestService.create', () => accessRequestService.create({ a: 1 }), 'post', ['/access-requests', { a: 1 }]],
  ['accessRequestService.evaluate', () => accessRequestService.evaluate('r1'), 'post', ['/access-requests/r1/evaluate']],
  ['accessRequestService.decide', () => accessRequestService.decide('r1', { d: 1 }), 'post', ['/access-requests/r1/decision', { d: 1 }]],
  ['accessRequestService.distribute', () => accessRequestService.distribute('r1'), 'post', ['/access-requests/r1/distribute']],
  ['accessRequestService.revoke', () => accessRequestService.revoke('r1', { justification: 'j' }), 'post', ['/access-requests/r1/revoke', { justification: 'j' }]],
  ['accessRequestService.accessCheck', () => accessRequestService.accessCheck('r1'), 'get', ['/access-requests/r1/access-check']],
  ['accessService.getAll', () => accessService.getAll(), 'get', ['/access']],
  ['accessService.getById', () => accessService.getById(5), 'get', ['/access/5']],
  ['accessService.create', () => accessService.create({ role: 'r' } as any), 'post', ['/access', { role: 'r' }]],
  ['accessService.update', () => accessService.update(5, { role: 's' } as any), 'put', ['/access/5', { role: 's' }]],
  ['accessService.delete', () => accessService.delete(5), 'delete', ['/access/5']],
  // reports
  ['reportsService.getAll', () => reportsService.getAll(), 'get', ['/reports']],
  ['reportsService.getById', () => reportsService.getById(6), 'get', ['/reports/6']],
  ['reportsService.generate', () => reportsService.generate('stock'), 'post', ['/reports/generate', { reportType: 'stock' }]],
  ['reportsService.delete', () => reportsService.delete(6), 'delete', ['/reports/6']],
  ['reportsService.getFilters', () => reportsService.getFilters('a b'), 'get', ['/reports/a%20b/filters']],
  ['reportsService.previewReport', () => reportsService.previewReport('a b', { filters: { x: 1 } }), 'post', ['/reports/a%20b/preview', { filters: { x: 1 } }]],
  // master data
  ['measurementUnitService.getAll', () => measurementUnitService.getAll(), 'get', ['/measurement-units']],
  ['measurementUnitService.getById', () => measurementUnitService.getById(1), 'get', ['/measurement-units/1']],
  ['measurementUnitService.create', () => measurementUnitService.create({ unit: 'mL' } as any), 'post', ['/measurement-units', { unit: 'mL' }]],
  ['measurementUnitService.update', () => measurementUnitService.update(1, { unit: 'L' } as any), 'put', ['/measurement-units/1', { unit: 'L' }]],
  ['measurementUnitService.delete', () => measurementUnitService.delete(1), 'delete', ['/measurement-units/1']],
  ['qualityDescriptionService.getAll', () => qualityDescriptionService.getAll(), 'get', ['/quality-descriptions']],
  ['qualityDescriptionService.getById', () => qualityDescriptionService.getById('q1'), 'get', ['/quality-descriptions/q1']],
  ['qualityDescriptionService.create', () => qualityDescriptionService.create({ id: 'q' } as any), 'post', ['/quality-descriptions', { id: 'q' }]],
  ['qualityDescriptionService.update', () => qualityDescriptionService.update('q1', { id: 'r' } as any), 'put', ['/quality-descriptions/q1', { id: 'r' }]],
  ['qualityDescriptionService.delete', () => qualityDescriptionService.delete('q1'), 'delete', ['/quality-descriptions/q1']],
  ['sampleTypeService.getAll', () => sampleTypeService.getAll(), 'get', ['/sample-types']],
  ['sampleTypeService.getById', () => sampleTypeService.getById('t1'), 'get', ['/sample-types/t1']],
  ['sampleTypeService.create', () => sampleTypeService.create({ id: 't' }), 'post', ['/sample-types', { id: 't' }]],
  ['analysisTypeService.getAll', () => analysisTypeService.getAll(), 'get', ['/analysis-types']],
  ['analysisTypeService.create', () => analysisTypeService.create({ name: 'N' }), 'post', ['/analysis-types', { name: 'N' }]],
  ['sampleOriginService.getAll', () => sampleOriginService.getAll(), 'get', ['/sample-origins']],
  ['sampleOriginService.getById', () => sampleOriginService.getById('o1'), 'get', ['/sample-origins/o1']],
  ['sampleOriginService.create', () => sampleOriginService.create({ id: 'o' }), 'post', ['/sample-origins', { id: 'o' }]],
  ['extractionProtocolService.getAll', () => extractionProtocolService.getAll(), 'get', ['/extraction-protocols']],
  ['extractionProtocolService.getById', () => extractionProtocolService.getById('x1'), 'get', ['/extraction-protocols/x1']],
  ['extractionProtocolService.create', () => extractionProtocolService.create({ id: 'x' }), 'post', ['/extraction-protocols', { id: 'x' }]],
  // logs and audit
  ['logService.getAll', () => logService.getAll(), 'get', ['/logs/all']],
  ['logService.getById', () => logService.getById('l1'), 'get', ['/logs/l1']],
  ['logService.getLogs', () => logService.getLogs({ page: 1 }), 'get', ['/logs', { params: { page: 1 } }]],
  ['logService.queryLogs', () => logService.queryLogs({ q: 1 }), 'post', ['/logs/query', { q: 1 }]],
  ['logService.exportExcel', () => logService.exportExcel({ a: 1 }), 'get', ['/logs/export/xlsx', { params: { a: 1 }, responseType: 'blob' }]],
  ['logService.getSessions', () => logService.getSessions({ isRevoked: 'true' }), 'get', ['/logs/sessions', { params: { isRevoked: 'true' } }]],
  ['auditService.getReport with a hash', () => auditService.getReport('2026-10-01', 'h1'), 'get', ['/audit/report/2026-10-01', { params: { hash: 'h1' } }]],
  ['auditService.getReport without a hash', () => auditService.getReport('2026-10-01'), 'get', ['/audit/report/2026-10-01', { params: undefined }]],
  ['auditService.verify', () => auditService.verify('h', ['p'], 'r'), 'post', ['/audit/verify', { hash: 'h', proof: ['p'], root: 'r' }]],
  // auth
  ['authService.login', () => authService.login('u', 'p', '123', 'n'), 'post', ['/auth/login', { username: 'u', password: 'p', twoFactorCode: '123', newPassword: 'n' }]],
  ['authService.logout', () => authService.logout(), 'post', ['/auth/logout']],
  ['authService.getSessions', () => authService.getSessions(), 'get', ['/auth/sessions']],
  ['authService.revokeSession', () => authService.revokeSession('s1'), 'delete', ['/auth/sessions/s1']],
  ['authService.revokeAllOtherSessions', () => authService.revokeAllOtherSessions(), 'delete', ['/auth/sessions/all-others']],
  ['authService.keepAlive', () => authService.keepAlive(), 'post', ['/auth/keepalive']],
  ['authService.generateTwoFactorQR', () => authService.generateTwoFactorQR(), 'get', ['/auth/two-factor/qr']],
  ['authService.enableTwoFactor', () => authService.enableTwoFactor('123'), 'post', ['/auth/two-factor/enable', { code: '123' }]],
  ['authService.disableTwoFactor', () => authService.disableTwoFactor('pw'), 'post', ['/auth/two-factor/disable', { password: 'pw' }]],
  ['authService.getTwoFactorStatus', () => authService.getTwoFactorStatus(), 'get', ['/auth/two-factor/status']],
  ['authService.generateTwoFactorQRFirstLogin', () => authService.generateTwoFactorQRFirstLogin('u', 'p'), 'post', ['/auth/two-factor/qr-first-login', { username: 'u', password: 'p' }]],
  ['authService.enableTwoFactorFirstLogin', () => authService.enableTwoFactorFirstLogin('1', 'u', 'p'), 'post', ['/auth/two-factor/enable-first-login', { code: '1', username: 'u', password: 'p' }]],
  ['authService.getPasswordPolicy', () => authService.getPasswordPolicy(), 'get', ['/auth/password-policy']],
  ['authService.requestPasswordReset', () => authService.requestPasswordReset('a@b.c'), 'post', ['/auth/password-reset/request', { email: 'a@b.c' }]],
  ['authService.resetPassword', () => authService.resetPassword('t', 'n'), 'post', ['/auth/password-reset/reset', { token: 't', newPassword: 'n' }]],
  // batch import, backup
  ['importService.getBatchImportStatus', () => importService.getBatchImportStatus('j1'), 'get', ['/import/batch/j1']],
  ['importService.listJobs', () => importService.listJobs({ status: 'done' }), 'get', ['/import/jobs', { params: { status: 'done' } }]],
  ['importService.getImportReport', () => importService.getImportReport('j1'), 'get', ['/import/job/j1/report']],
  ['backupService.performBackup', () => backupService.performBackup(), 'post', ['/backup/perform']],
  ['backupService.listBackups', () => backupService.listBackups(), 'get', ['/backup/list']],
  ['backupService.restoreBackup', () => backupService.restoreBackup('f.gz'), 'post', ['/backup/restore/f.gz']],
  ['backupPolicyService.getPolicy', () => backupPolicyService.getPolicy(), 'get', ['/backup-policy']],
  ['backupPolicyService.updatePolicy', () => backupPolicyService.updatePolicy({ r: 1 }), 'put', ['/backup-policy', { r: 1 }]],
  // consent
  ['consentService.createTemplate', () => consentService.createTemplate({ title: 'T' } as any), 'post', ['/e-consent/consent-templates', { title: 'T' }]],
  ['consentService.getTemplates', () => consentService.getTemplates({ suppressAuthRedirect: true }), 'get', ['/e-consent/consent-templates', { suppressAuthRedirect: true }]],
  ['consentService.getActiveTemplate', () => consentService.getActiveTemplate(), 'get', ['/e-consent/consent-templates/current']],
  ['consentService.getTemplateById', () => consentService.getTemplateById('t1'), 'get', ['/e-consent/consent-templates/t1']],
  ['consentService.updateTemplate', () => consentService.updateTemplate('t1', { title: 'U' } as any), 'put', ['/e-consent/consent-templates/t1', { title: 'U' }]],
  ['consentService.getPurposeCodes', () => consentService.getPurposeCodes(), 'get', ['/e-consent/purpose-codes']],
  ['consentService.createPatientConsent', () => consentService.createPatientConsent({ participantId: 'P', templateId: 't', responses: { a: true } }), 'post', ['/e-consent/consents', { participantId: 'P', templateId: 't', responses: { a: true } }]],
  ['consentService.getPatientConsent', () => consentService.getPatientConsent('P1'), 'get', ['/patients/P1/consent']],
  ['consentTokenService.validate', () => consentTokenService.validate('P1', 'tok'), 'post', ['/e-consent/consent-tokens/validate', { patientId: 'P1', token: 'tok' }]],
  ['consentTokenService.accept', () => consentTokenService.accept('P1', 'tok', { consentTemplateId: 't1', responses: { a: true } }), 'post', ['/e-consent/consent-tokens/accept', { patientId: 'P1', token: 'tok', consentTemplateId: 't1', responses: { a: true } }]],
  ['eConsentService.validate', () => eConsentService.validate('a/b'), 'get', ['/e-consent/validate/a%2Fb']],
  ['eConsentService.update', () => eConsentService.update('tok', [{ key: 'k', status: 'ACCEPTED' }]), 'post', ['/e-consent/update', { token: 'tok', consents: [{ key: 'k', status: 'ACCEPTED' }] }]],
  ['eConsentService.validateImportConsent', () => eConsentService.validateImportConsent('a/b'), 'get', ['/e-consent/import/fhir/consent/a%2Fb']],
  ['eConsentService.acceptImportConsent', () => eConsentService.acceptImportConsent('a/b'), 'post', ['/e-consent/import/fhir/consent/a%2Fb/accept']],
  // LGPD import
  ['importLGPDService.import patients', () => importLGPDService.import('patients', fd), 'post', ['/import-lgpd/pacientes', fd, multipart]],
  ['importLGPDService.import samples', () => importLGPDService.import('samples', fd), 'post', ['/import-lgpd/amostras', fd, multipart]],
  ['importLGPDService.downloadTemplate patients', () => importLGPDService.downloadTemplate('patients', 'csv'), 'get', ['/import-lgpd/pacientes/template/csv', { responseType: 'blob' }]],
  ['importLGPDService.downloadTemplate samples', () => importLGPDService.downloadTemplate('samples', 'xlsx'), 'get', ['/import-lgpd/amostras/template/xlsx', { responseType: 'blob' }]],
  ['importLGPDService.listQuarantineBatches', () => importLGPDService.listQuarantineBatches({ page: 2 }), 'get', ['/import-lgpd/batches', { params: { page: 2 } }]],
  ['importLGPDService.getQuarantineBatch', () => importLGPDService.getQuarantineBatch('b/1'), 'get', ['/import-lgpd/batches/b%2F1']],
  ['importLGPDService.resubmitQuarantinedRow', () => importLGPDService.resubmitQuarantinedRow('b1', 'r/1', { a: 'x' }), 'post', ['/import-lgpd/batches/b1/records/r%2F1/resubmit', { row: { a: 'x' } }]],
  // security
  ['securityService.getConfig', () => securityService.getConfig(), 'get', ['/security/config']],
  ['securityService.updateConfig', () => securityService.updateConfig({ a: 1 }), 'put', ['/security/config', { a: 1 }]],
  ['securityService.getReleases', () => securityService.getReleases(), 'get', ['/security/config/releases']],
  ['securityService.rollbackConfig', () => securityService.rollbackConfig('rel1'), 'post', ['/security/config/rollback', { configurationReleaseId: 'rel1' }]],
  ['securityService.getPermissions', () => securityService.getPermissions(), 'get', ['/security/permissions']],
  ['securityService.getSessions', () => securityService.getSessions(), 'get', ['/auth/sessions']],
  ['securityService.getConsentQueueStatus', () => securityService.getConsentQueueStatus(), 'get', ['/security/consent-queue']],
  ['userSecurityService.getStatus', () => userSecurityService.getStatus(), 'get', ['/user/security/status']],
  ['userSecurityService.getMFAStatus', () => userSecurityService.getMFAStatus(), 'get', ['/user/security/mfa']],
  ['userSecurityService.getPasswordStatus', () => userSecurityService.getPasswordStatus(), 'get', ['/user/security/password']],
  ['userSecurityService.getSessions', () => userSecurityService.getSessions(), 'get', ['/auth/sessions']],
  ['userSecurityService.getActivities', () => userSecurityService.getActivities(), 'get', ['/user/security/activities']],
  ['userSecurityService.updatePassword', () => userSecurityService.updatePassword('a', 'b'), 'put', ['/user/security/password', { currentPassword: 'a', newPassword: 'b' }]],
  ['userSecurityService.generateRecoveryCodes', () => userSecurityService.generateRecoveryCodes(), 'post', ['/user/security/recovery-codes']],
  ['userSecurityService.revokeSession', () => userSecurityService.revokeSession('s1'), 'delete', ['/auth/sessions/s1']],
  ['userSecurityService.revokeAllSessions', () => userSecurityService.revokeAllSessions(), 'delete', ['/auth/sessions/all-others']],
  ['userSecurityService.requestPasswordReset', () => userSecurityService.requestPasswordReset(), 'post', ['/user/security/password-reset/request']],
];

describe('api service routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(rows)('%s', async (_name, call, verb, args) => {
    const spies = {
      get: vi.spyOn(api, 'get').mockResolvedValue({ data: {} } as any),
      post: vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any),
      put: vi.spyOn(api, 'put').mockResolvedValue({ data: {} } as any),
      delete: vi.spyOn(api, 'delete').mockResolvedValue({ data: {} } as any),
    };

    await call();

    expect(spies[verb]).toHaveBeenCalledTimes(1);
    expect(spies[verb]).toHaveBeenCalledWith(...args);
    for (const other of Object.keys(spies) as Verb[]) {
      if (other !== verb) expect(spies[other]).not.toHaveBeenCalled();
    }
  });

  it('analysisFileService.upload passes the progress callback through', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any);
    const onUploadProgress = vi.fn();
    await analysisFileService.upload(fd, onUploadProgress);
    expect(post).toHaveBeenCalledWith('/analysis-files/upload', fd, { ...multipart, onUploadProgress });
  });

  it.each([
    ['importService.batchImport', () => importService.batchImport(new File(['x'], 'a.csv')), '/import/batch', { file: 'a.csv' }],
    ['importService.uploadFile', () => importService.uploadFile(new File(['x'], 'a.csv'), 'samples'), '/import/upload', { file: 'a.csv', dataType: 'samples' }],
  ])('%s posts the file as multipart form data', async (_name, call, url, fields) => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any);
    await (call as () => unknown)();
    const [sentUrl, body, options] = post.mock.calls[0];
    expect(sentUrl).toBe(url);
    expect(options).toEqual(multipart);
    const sent = Object.fromEntries(
      [...(body as FormData).entries()].map(([k, v]) => [k, v instanceof File ? v.name : v]),
    );
    expect(sent).toEqual(fields);
  });
});

describe('query strings built from filters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reportsService.exportReport keeps only set filters and asks for text on csv', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: '' } as any);
    await reportsService.exportReport('a b', 'csv', { from: '2026-01-01', empty: '', none: null, gone: undefined, n: 0 });
    expect(get).toHaveBeenCalledWith('/reports/a%20b/export?from=2026-01-01&n=0', { responseType: 'text' });
  });

  it('reportsService.exportReport uses the pdf route and json with no filters', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} } as any);
    await reportsService.exportReport('stock', 'pdf');
    expect(get).toHaveBeenCalledWith('/reports/stock/export/pdf?', { responseType: 'json' });
  });

  it('securityService.exportLogs defaults to csv and drops empty filters', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: '' } as any);
    await securityService.exportLogs({ user: 'u', empty: '', none: null });
    expect(get).toHaveBeenCalledWith('/security/logs/export?user=u&format=csv', { responseType: 'text' });
  });

  it('securityService.exportLogs asks for json with no filters', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as any);
    await securityService.exportLogs(undefined, 'json');
    expect(get).toHaveBeenCalledWith('/security/logs/export?format=json', { responseType: 'json' });
  });
});

describe('authService.verifyToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the verify response when the route answers', async () => {
    const res = { data: { success: true, data: { valid: true, user: 'u' } } };
    vi.spyOn(api, 'get').mockResolvedValue(res as any);
    await expect(authService.verifyToken()).resolves.toBe(res);
  });

  it('falls back to keepalive on a 404 and reports the session valid', async () => {
    vi.spyOn(api, 'get').mockRejectedValue({ response: { status: 404 } });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 200, data: { ok: 1 } } as any);
    await expect(authService.verifyToken()).resolves.toEqual({ status: 200, data: { success: true, data: { valid: true } } });
    expect(post).toHaveBeenCalledWith('/auth/keepalive');
  });

  it.each([
    ['a 401', { response: { status: 401 } }],
    ['a network error with no response', new Error('Network Error')],
  ])('rethrows %s without the keepalive', async (_label, err) => {
    vi.spyOn(api, 'get').mockRejectedValue(err);
    const post = vi.spyOn(api, 'post');
    await expect(authService.verifyToken()).rejects.toBe(err);
    expect(post).not.toHaveBeenCalled();
  });
});
