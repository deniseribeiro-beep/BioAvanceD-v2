const crypto = require('crypto');

// RF007 AC2 / RNF016 C4 (#1321): AWS Signature Version 4 for the
// S3-compatible object store, hand-rolled over `crypto` as the repo's other
// HTTP clients are hand-rolled over `fetch`. Only requests with an empty
// query string are signed; the store sends no other kind.

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// RFC 3986: encodeURIComponent leaves !'()* unescaped, SigV4 does not.
function encodeRfc3986(segment) {
  return encodeURIComponent(segment)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(pathname) {
  return pathname
    .split('/')
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join('/');
}

function toAmzDate(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function signRequest({
  method,
  url,
  headers,
  payloadHash,
  region,
  service = 's3',
  accessKeyId,
  secretAccessKey,
  date
}) {
  const amzDate = toAmzDate(date);
  const dateStamp = amzDate.slice(0, 8);
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = entries.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = entries.map(([name]) => name).join(';');

  const canonicalRequest = [
    method,
    canonicalUri(new URL(url).pathname),
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate
  };
}

module.exports = { signRequest, toAmzDate };
