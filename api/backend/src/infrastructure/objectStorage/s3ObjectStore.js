const {
  ownerSegment,
  isValidSegment,
  assertSegment,
  sha256Hex,
  storeError,
  OBJECT_URI_PATTERN,
  PLAIN_OWNER_PATTERN
} = require('./filesystemObjectStore');
const { signRequest, toAmzDate } = require('./awsSigV4');

// RF007 AC2 / RNF016 C4 (#1321): the S3-compatible adapter behind the same
// `putObject` / `getObject` interface and key rule as the filesystem store.
// Objects are addressed path-style (`<endpoint>/<bucket>/<key>`, as MinIO
// serves them) and written once: a PUT carries `If-None-Match: *`, and an
// existing object is reused only when its bytes hash to the key. The store
// has no delete and no overwrite.
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const EMPTY_PAYLOAD_SHA256 = sha256Hex(Buffer.alloc(0));

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// The object URLs are built from the parsed endpoint, so one with a query, a
// fragment or credentials, which would move or hide the key, is refused, as
// is a path whose percent-escapes the signer cannot decode.
function parseEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
    decodeURIComponent(url.pathname);
  } catch (_error) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return url;
}

function createS3ObjectStore({
  endpoint,
  bucket,
  region = 'us-east-1',
  accessKeyId,
  secretAccessKey,
  timeoutMs = 30000,
  fetchImpl = globalThis.fetch,
  now = () => new Date()
} = {}) {
  const endpointUrl = typeof endpoint === 'string' ? parseEndpoint(endpoint) : null;
  if (!endpointUrl) {
    // Names the cause only: an endpoint with userinfo would print its secret.
    throw new Error('endpoint do Object Storage S3 inválido (protocolo, consulta, fragmento ou credenciais não permitidos).');
  }
  if (typeof bucket !== 'string' || !BUCKET_PATTERN.test(bucket)) {
    throw new Error(`bucket do Object Storage S3 inválido: ${bucket}.`);
  }
  if (!isNonEmptyString(accessKeyId) || !isNonEmptyString(secretAccessKey)) {
    throw new Error('credenciais do Object Storage S3 ausentes.');
  }
  const base = `${endpointUrl.origin}${endpointUrl.pathname.replace(/\/+$/, '')}`;

  function objectUrl(area, owner, hex) {
    return `${base}/${bucket}/${area}/${owner}/sha256/${hex}`;
  }

  // Never names the secret or the authorization header. Status 503, so an
  // upload's catch answers the outage rather than its default 400.
  function unavailable(uri, reason) {
    const error = storeError('OBJECT_STORE_UNAVAILABLE', `Object Storage S3 indisponível para ${uri}: ${reason}.`);
    error.statusCode = 503;
    return error;
  }

  async function send(method, url, uri, { body, payloadHash, extraHeaders = {} }) {
    const date = now();
    const headers = {
      host: new URL(url).host,
      ...extraHeaders,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': toAmzDate(date)
    };
    const { authorization } = signRequest({
      method, url, headers, payloadHash, region, accessKeyId, secretAccessKey, date
    });
    // fetch sets Host from the URL, the same value signed above.
    const { host: _host, ...sent } = headers;
    let response;
    let bytes;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { ...sent, authorization },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw unavailable(uri, `${method} falhou (${(error && error.name) || 'erro'})`);
    }
    return { status: response.status, bytes };
  }

  async function putObject({ area, ownerKey, body } = {}) {
    assertSegment('area', area);
    const owner = ownerSegment(ownerKey);
    if (!Buffer.isBuffer(body)) {
      throw storeError('OBJECT_KEY_INVALID', 'O corpo do objeto deve ser um Buffer.');
    }

    const hex = sha256Hex(body);
    const uri = `objstore://${area}/${owner}/sha256/${hex}`;
    const url = objectUrl(area, owner, hex);
    const result = { uri, version: `sha256:${hex}`, path: null };

    const put = await send('PUT', url, uri, {
      body,
      payloadHash: hex,
      extraHeaders: { 'if-none-match': '*' }
    });
    if (put.status === 200) return result;
    if (put.status !== 412 && put.status !== 409) {
      throw unavailable(uri, `PUT respondeu ${put.status}`);
    }

    // The object exists: it is reused only when its bytes are this body's,
    // and it is never put again.
    const existing = await send('GET', url, uri, { payloadHash: EMPTY_PAYLOAD_SHA256 });
    if (existing.status < 200 || existing.status > 299) {
      throw unavailable(uri, `GET respondeu ${existing.status}`);
    }
    const stored = sha256Hex(existing.bytes);
    if (stored !== hex) {
      throw storeError('OBJECT_CONFLICT', `${uri} já guarda outro conteúdo (sha256 ${stored}).`);
    }
    return result;
  }

  async function getObject(uri) {
    const match = typeof uri === 'string' ? OBJECT_URI_PATTERN.exec(uri) : null;
    if (!match || !isValidSegment(match[1]) || !PLAIN_OWNER_PATTERN.test(match[2])) {
      throw storeError('OBJECT_KEY_INVALID', `URI de Object Storage inválida: ${uri}.`);
    }
    const [, area, owner, hex] = match;
    const response = await send('GET', objectUrl(area, owner, hex), uri, { payloadHash: EMPTY_PAYLOAD_SHA256 });
    if (response.status === 404) {
      // The code a missing filesystem object carries, so callers map both alike.
      throw storeError('ENOENT', `${uri} não existe no Object Storage.`);
    }
    if (response.status < 200 || response.status > 299) {
      throw unavailable(uri, `GET respondeu ${response.status}`);
    }
    if (sha256Hex(response.bytes) !== hex) {
      throw storeError('OBJECT_CONFLICT', `${uri} não corresponde ao seu conteúdo.`);
    }
    return response.bytes;
  }

  return { putObject, getObject };
}

module.exports = { createS3ObjectStore };
