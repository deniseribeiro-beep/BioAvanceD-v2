const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const { isRecordInOrganizationScope } = require('../../services/rbac-assignment.service');
const createLinkedFileController = require('../../controllers/createLinkedFileController');

// #643 (RF007 AC#6/gate F3-G05): scientific-file linkage for Assay,
// mirroring sample.routes.js's file sub-routes but mounted at
// /api/assays/:assayId/files/... -- gated the same way Assay's own
// create/update/delete already is (requireRole(3,4), the
// createMasterDataRouter precedent #641 used), not a new permission code.
//
// #644: Assay has an organization concept (laboratoryId -> Organization,
// dict-02 ELM-0293), unlike Dataset (dataset-file.routes.js), so it wires
// requireOrganizationScope + createLinkedFileController's checkOrgScope
// hook, mirroring sample.routes.js's file sub-routes' own org-scope
// enforcement (#625).
const router = express.Router({ mergeParams: true });

const controller = createLinkedFileController({
  parentCollectionName: 'assays',
  parentIdParam: 'assayId',
  parentIdField: 'assayId',
  fileCollectionName: 'assayFiles',
  storageSubdir: 'assays',
  resourceType: 'AssayFile',
  moduleLabel: 'Ensaios',
  checkOrgScope: (parent, req) => isRecordInOrganizationScope(parent, req.organizationScope, 'laboratoryId')
});

router.post('/upload', authenticate, requireRole(3, 4), requireOrganizationScope, controller.uploadMiddleware(), controller.uploadFile);
router.get('/', authenticate, requireOrganizationScope, controller.listFiles);
router.get('/:fileID/download', authenticate, requireOrganizationScope, controller.downloadFile);
router.delete('/:fileID', authenticate, requireRole(3, 4), requireOrganizationScope, controller.deleteFile);
router.put('/:fileID/replace', authenticate, requireRole(3, 4), requireOrganizationScope, controller.uploadMiddleware(), controller.replaceFile);

module.exports = router;
