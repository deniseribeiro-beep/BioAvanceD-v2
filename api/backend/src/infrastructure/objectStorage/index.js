// RF007 AC2 / RNF016 C4 (#1321): one object-store interface for DataFile
// binaries, `putObject` and `getObject`, with no delete and no overwrite.
// The filesystem adapter under STORAGE_BASE is the store today; an
// S3-compatible adapter is the next one behind the same interface.
const { STORAGE_BASE } = require('../../config/uploadConfig');
const { createFilesystemObjectStore } = require('./filesystemObjectStore');

let fileObjectStore = null;

function getFileObjectStore() {
  if (!fileObjectStore) {
    fileObjectStore = createFilesystemObjectStore({ root: STORAGE_BASE });
  }
  return fileObjectStore;
}

module.exports = { createFilesystemObjectStore, getFileObjectStore };
