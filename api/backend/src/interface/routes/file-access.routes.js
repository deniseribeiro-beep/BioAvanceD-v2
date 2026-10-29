const express = require('express');
const controller = require('../../controllers/fileAccess.controller');

// RNF029 C5 (#1321): GET /api/file-access?token=<file access token>. The
// download handlers run their own authentication, role and scope checks,
// then redirect here with a short-lived token for one file. The token is the
// credential, so this route carries no authenticate: an expired, tampered or
// superseded token is refused and audited by the controller.
const router = express.Router();

router.get('/', controller.serveFileByAccessToken);

module.exports = router;
