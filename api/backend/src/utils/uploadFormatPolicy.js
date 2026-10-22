const fs = require('fs');

/**
 * #1321 (RF007 AC1, RNF029 C1): an upload is accepted only when its
 * extension is known, its MIME is allowed for that extension, and its
 * leading bytes match the format. Every extension also accepts
 * application/octet-stream, the generic binary label browsers send for an
 * unknown type: the bytes then decide. See
 * docs/decisions/2026-10-23-upload-mime-extension-signature.md.
 */
const OCTET_STREAM = 'application/octet-stream';
const HEAD_BYTES = 8192;

const bytes = (...values) => Buffer.from(values);

const PDF_MARKER = Buffer.from('%PDF-', 'latin1');
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff);
const ZIP_LOCAL = bytes(0x50, 0x4b, 0x03, 0x04);
const ZIP_EMPTY = bytes(0x50, 0x4b, 0x05, 0x06);
const ZIP_SPANNED = bytes(0x50, 0x4b, 0x07, 0x08);
const OLE2 = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const RAR = bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07);
const GZIP = bytes(0x1f, 0x8b);
const HDF5 = bytes(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a);
const HDF5_OFFSETS = [0, 512, 1024, 2048, 4096];
const FCS = Buffer.from('FCS', 'latin1');

// A #! script line.
const SCRIPT_SIGNATURES = [bytes(0x23, 0x21)];
// MZ (PE), ELF, Mach-O (both endiannesses, 32/64 bit, fat) and a #! script.
const EXECUTABLE_SIGNATURES = [
  bytes(0x4d, 0x5a),
  bytes(0x7f, 0x45, 0x4c, 0x46),
  bytes(0xfe, 0xed, 0xfa, 0xce),
  bytes(0xfe, 0xed, 0xfa, 0xcf),
  bytes(0xce, 0xfa, 0xed, 0xfe),
  bytes(0xcf, 0xfa, 0xed, 0xfe),
  bytes(0xca, 0xfe, 0xba, 0xbe),
  ...SCRIPT_SIGNATURES
];

const startsWithAt = (head, signature, offset = 0) =>
  head.length >= offset + signature.length
  && head.subarray(offset, offset + signature.length).equals(signature);

const SIGNATURES = {
  pdf: (head) => head.subarray(0, 1024).indexOf(PDF_MARKER) !== -1,
  png: (head) => startsWithAt(head, PNG),
  jpeg: (head) => startsWithAt(head, JPEG),
  zip: (head) => [ZIP_LOCAL, ZIP_EMPTY, ZIP_SPANNED].some((sig) => startsWithAt(head, sig)),
  ooxml: (head) => startsWithAt(head, ZIP_LOCAL),
  ole2: (head) => startsWithAt(head, OLE2),
  rar: (head) => startsWithAt(head, RAR),
  gzip: (head) => startsWithAt(head, GZIP),
  hdf5: (head) => HDF5_OFFSETS.some((offset) => startsWithAt(head, HDF5, offset)),
  fcs: (head) => startsWithAt(head, FCS),
  // A text format holds no NUL byte, unless it is UTF-16 with its BOM.
  text: (head) => startsWithAt(head, bytes(0xff, 0xfe))
    || startsWithAt(head, bytes(0xfe, 0xff))
    || head.indexOf(0x00) === -1,
  // Vendor raw formats share no signature.
  none: () => true
};

const policy = (mimes, signature) => Object.freeze({ mimes: Object.freeze(mimes), signature });

const FORMAT_POLICY = Object.freeze({
  '.pdf': policy(['application/pdf'], 'pdf'),
  '.png': policy(['image/png'], 'png'),
  '.jpg': policy(['image/jpeg', 'image/pjpeg'], 'jpeg'),
  '.jpeg': policy(['image/jpeg', 'image/pjpeg'], 'jpeg'),
  '.zip': policy(['application/zip', 'application/x-zip-compressed'], 'zip'),
  '.xlsx': policy(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], 'ooxml'),
  '.xls': policy(['application/vnd.ms-excel'], 'ole2'),
  '.rar': policy(['application/vnd.rar', 'application/x-rar-compressed', 'application/x-rar'], 'rar'),
  '.fastq.gz': policy(['application/gzip', 'application/x-gzip'], 'gzip'),
  '.vcf.gz': policy(['application/gzip', 'application/x-gzip'], 'gzip'),
  // BAM is BGZF, a gzip member.
  '.bam': policy([], 'gzip'),
  '.h5': policy(['application/x-hdf5', 'application/x-hdf'], 'hdf5'),
  '.fcs': policy(['application/vnd.isac.fcs'], 'fcs'),
  // Windows browsers send application/vnd.ms-excel for .csv.
  '.csv': policy(['text/csv', 'application/vnd.ms-excel', 'text/plain'], 'text'),
  '.tsv': policy(['text/tab-separated-values', 'text/plain'], 'text'),
  '.txt': policy(['text/plain'], 'text'),
  '.sam': policy(['text/plain'], 'text'),
  '.fastq': policy(['text/plain'], 'text'),
  '.json': policy(['application/json', 'text/plain'], 'text'),
  // Browsers map .vcf to vCard.
  '.vcf': policy(['text/vcard', 'text/x-vcard', 'text/plain'], 'text'),
  '.raw': policy([], 'none')
});

const hasPolicy = (ext) => typeof ext === 'string' && Object.prototype.hasOwnProperty.call(FORMAT_POLICY, ext);

function isMimeAllowedForExtension(ext, mime) {
  if (!hasPolicy(ext) || typeof mime !== 'string') return false;
  const essence = mime.split(';')[0].trim().toLowerCase();
  if (!essence) return false;
  return essence === OCTET_STREAM || FORMAT_POLICY[ext].mimes.includes(essence);
}

function readHead(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function checkFileSignature(filePath, ext) {
  if (!hasPolicy(ext)) {
    return { ok: false, reason: `extension ${ext} has no format policy` };
  }
  let head;
  try {
    head = readHead(filePath);
  } catch (error) {
    return { ok: false, reason: `file could not be read: ${error.message}` };
  }
  const { signature } = FORMAT_POLICY[ext];
  // A text format refuses only a #! head: a real PE, ELF or Mach-O header
  // holds NUL bytes, which the text rule already refuses, while a header row
  // such as 'MZ,Intensity' (mass spectrometry) is ordinary data.
  const executableSignatures = signature === 'text' ? SCRIPT_SIGNATURES : EXECUTABLE_SIGNATURES;
  if (executableSignatures.some((sig) => startsWithAt(head, sig))) {
    return { ok: false, reason: 'file starts with an executable signature' };
  }
  if (!SIGNATURES[signature](head)) {
    return { ok: false, reason: `file content does not match the ${signature} signature` };
  }
  return { ok: true };
}

module.exports = {
  FORMAT_POLICY,
  isMimeAllowedForExtension,
  checkFileSignature
};
