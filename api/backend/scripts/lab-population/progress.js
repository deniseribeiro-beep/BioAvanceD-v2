'use strict';

const fs = require('fs');
const path = require('path');

function defaultProgressPath(outDir, runId) {
  return path.join(outDir || process.cwd(), `progress-${runId}.json`);
}

function createProgress({ runId, seed, schemaVersion, nTarget, chunkSize, chunks }) {
  return {
    runId,
    seed,
    schemaVersion,
    nTarget,
    chunkSize,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastGoodChunk: -1,
    resumedAt: null,
    chunks: chunks.map((c) => ({
      i: c.i,
      start: c.start,
      end: c.end,
      status: 'pending',
      counts: { participants: 0, specimens: 0, errors: 0 },
      error: null,
      startedAt: null,
      finishedAt: null,
    })),
  };
}

function loadProgress(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveProgress(filePath, progress) {
  progress.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function markChunk(progress, chunkIndex, patch) {
  const chunk = progress.chunks.find((c) => c.i === chunkIndex);
  if (!chunk) throw new Error(`chunk ${chunkIndex} not in progress`);
  Object.assign(chunk, patch);
  if (chunk.status === 'done') {
    progress.lastGoodChunk = Math.max(progress.lastGoodChunk, chunkIndex);
  }
}

function summarizeProgress(progress) {
  const by = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const c of progress.chunks) by[c.status] = (by[c.status] || 0) + 1;
  const doneParticipants = progress.chunks
    .filter((c) => c.status === 'done')
    .reduce((acc, c) => acc + (c.counts?.participants || 0), 0);
  const pct = progress.nTarget ? Math.round((doneParticipants / progress.nTarget) * 1000) / 10 : 0;
  return { by, doneParticipants, pct, lastGoodChunk: progress.lastGoodChunk };
}

function estimateEta(progress, startedAtMs, nowMs = Date.now()) {
  const done = progress.chunks.filter((c) => c.status === 'done').length;
  const total = progress.chunks.length;
  if (done === 0) return { etaSeconds: null, rateChunksPerMin: null, remainingChunks: total };
  const elapsedSec = Math.max(1, (nowMs - startedAtMs) / 1000);
  const rate = done / elapsedSec;
  const remaining = total - done;
  return {
    remainingChunks: remaining,
    rateChunksPerMin: Math.round(rate * 60 * 100) / 100,
    etaSeconds: rate > 0 ? Math.round(remaining / rate) : null,
  };
}

module.exports = {
  defaultProgressPath,
  createProgress,
  loadProgress,
  saveProgress,
  markChunk,
  summarizeProgress,
  estimateEta,
};
