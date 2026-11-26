const { execFile } = require('child_process');
const { mkdtemp, writeFile, readFile, rm } = require('fs/promises');
const os = require('os');
const path = require('path');
const env = require('../config/env');
const { currentRequestId, requestIdHeaders } = require('../utils/requestContext');

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

class AuditTsaService {
  async requestTimestamp(messageImprintHex) {
    const tsaUrl = String(env.AUDIT_RFC3161_TSA_URL || '').trim();
    if (!tsaUrl) throw new Error('AUDIT_RFC3161_TSA_URL não configurado');
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'audit-tsa-'));
    const queryPath = path.join(workDir, 'request.tsq');
    const replyPath = path.join(workDir, 'reply.tsr');
    try {
      await execFileAsync('openssl', ['ts', '-query', '-digest', messageImprintHex, '-sha256', '-cert', '-out', queryPath], { windowsHide: true });
      const queryBuffer = await readFile(queryPath);
      const response = await fetch(tsaUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/timestamp-query',
          // #1468 (RNF015 C3): the caller's request or job id, so the call can be tied to it.
          ...(requestIdHeaders(currentRequestId()) || {}),
        },
        body: queryBuffer,
      });
      if (!response.ok) throw new Error(`tsa_http_${response.status}`);
      const replyBuffer = Buffer.from(await response.arrayBuffer());
      await writeFile(replyPath, replyBuffer);
      return {
        status: 'TIMESTAMPED',
        token: replyBuffer.toString('base64'),
        tokenDerHex: replyBuffer.toString('hex'),
        messageImprint: messageImprintHex,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

module.exports = new AuditTsaService();
