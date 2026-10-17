const env = require('../config/env');

/**
 * #1378: Sample.barcode (ELM-0116) is deprecated, "Replaced by LabelIdentifier
 * records", and its migration note ends "reject legacy writes after migration
 * window". The window is open until SAMPLE_BARCODE_WINDOW_CLOSED is set. The
 * flag is read at each call, never at require.
 */
const LEGACY_BARCODE_WRITE_REFUSED = 'LEGACY_BARCODE_WRITE_REFUSED';

function sampleBarcodeWindowOpen() {
  return env.SAMPLE_BARCODE_WINDOW_CLOSED !== true;
}

// The sample to insert: unchanged while the window is open, else without its
// barcode key. The code is then issued only as the LabelIdentifier.
function withoutLegacyBarcode(sample) {
  if (sampleBarcodeWindowOpen()) return sample;
  const stripped = { ...sample };
  delete stripped.barcode;
  return stripped;
}

// Once the window is closed, an update naming barcode, with any value, is
// refused before anything is written.
function assertLegacyBarcodeWritable(updateData) {
  if (sampleBarcodeWindowOpen()) return;
  if (!updateData || !Object.prototype.hasOwnProperty.call(updateData, 'barcode')) return;
  const error = new Error('Sample.barcode (ELM-0116) não é mais gravado: o código da amostra é um LabelIdentifier');
  error.statusCode = 422;
  error.code = LEGACY_BARCODE_WRITE_REFUSED;
  throw error;
}

module.exports = {
  LEGACY_BARCODE_WRITE_REFUSED,
  sampleBarcodeWindowOpen,
  withoutLegacyBarcode,
  assertLegacyBarcodeWritable,
};
