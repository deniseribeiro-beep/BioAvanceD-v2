// RF007 AC2 / RNF016 C4 (#1419): creates the test stack's object-store bucket
// once, so backend-app-test can put DataFile binaries through the S3 driver.
// It signs a path-style CreateBucket PUT with the backend's own SigV4 signer
// (mounted read-only at /s3), so no S3 client image is pulled. A 200 is a new
// bucket and a 409 BucketAlreadyOwnedByYou one this stack made before (a
// named volume survives a down/up); anything else exits 1 naming the status.
const { signRequest, toAmzDate } = require(process.env.S3_SIGNER_PATH || '/s3/awsSigV4.js');

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

async function main() {
  const endpoint = process.env.OBJECT_STORE_S3_ENDPOINT;
  const bucket = process.env.OBJECT_STORE_S3_BUCKET;
  const region = process.env.OBJECT_STORE_S3_REGION || 'us-east-1';
  const accessKeyId = process.env.OBJECT_STORE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OBJECT_STORE_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    console.error('s3 bucket init: OBJECT_STORE_S3_ENDPOINT, _BUCKET, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY are required');
    return 1;
  }
  const url = `${endpoint.replace(/\/+$/, '')}/${bucket}`;
  const date = new Date();
  const headers = {
    host: new URL(url).host,
    'x-amz-content-sha256': EMPTY_SHA256,
    'x-amz-date': toAmzDate(date)
  };
  const { authorization } = signRequest({
    method: 'PUT', url, headers, payloadHash: EMPTY_SHA256, region, accessKeyId, secretAccessKey, date
  });
  const { host: _host, ...sent } = headers;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...sent, authorization },
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (response.status === 200) {
    console.log(`s3 bucket init: created ${bucket}`);
    return 0;
  }
  if (response.status === 409 && body.includes('<Code>BucketAlreadyOwnedByYou</Code>')) {
    console.log(`s3 bucket init: reusing ${bucket}`);
    return 0;
  }
  console.error(`s3 bucket init: PUT ${bucket} answered ${response.status}: ${body.slice(0, 300)}`);
  return 1;
}

main().then((code) => process.exit(code), (error) => {
  console.error(`s3 bucket init: ${(error && error.name) || 'error'}: ${(error && error.message) || error}`);
  process.exit(1);
});
