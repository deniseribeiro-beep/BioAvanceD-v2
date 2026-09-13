const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const env = require('./env');

// #893: read_only:true containers in compose.prod.yml have no writable
// mount under /app, so a root anchored on __dirname (inside the install
// directory) fails EROFS on the first upload. UPLOAD_DIR/STORAGE_DIR let
// prod point these at a volume mounted outside /app while every other
// caller keeps today's default byte for byte.
const UPLOADS_BASE = env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const STORAGE_BASE = env.STORAGE_DIR || path.join(__dirname, '../../storage');
const UPLOAD_ROOT = path.join(UPLOADS_BASE, 'analysis');

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const sanitizeName = (name) => {
  const baseName = path.basename(name || 'file');
  return baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const targetDir = path.join(UPLOAD_ROOT, year, month);
      ensureDir(targetDir);
      cb(null, targetDir);
    } catch (error) {
      cb(error, null);
    }
  },
  filename: (req, file, cb) => {
    try {
      const safeOriginal = sanitizeName(file.originalname);
      const fileName = `${Date.now()}-${uuidv4()}-${safeOriginal}`;
      cb(null, fileName);
    } catch (error) {
      cb(error, null);
    }
  }
});

const blockedExtensions = new Set(['.exe', '.bat', '.sh']);
const allowedExtensions = new Set([
  '.jpg', '.jpeg', '.png',
  '.pdf',
  '.raw', '.fcs',
  '.csv', '.txt',
  '.zip', '.rar'
]);

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'text/csv',
  'text/plain',
  'application/octet-stream'
]);

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (blockedExtensions.has(ext)) {
    return cb(new Error('File type not allowed'), false);
  }

  const isAllowedExt = allowedExtensions.has(ext);
  const isAllowedMime = allowedMimeTypes.has(file.mimetype);

  if (!isAllowedExt && !isAllowedMime) {
    return cb(new Error('Invalid file type'), false);
  }

  return cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }
});

module.exports = {
  upload,
  storage,
  fileFilter,
  UPLOAD_ROOT,
  UPLOADS_BASE,
  STORAGE_BASE
};
