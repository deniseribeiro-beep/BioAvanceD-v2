// RNF015 C2 (#1468): the backend's memory and disk in use, as ratios in
// [0, 1] for the RESOURCE_MEMORY and RESOURCE_DISK platform alert rules.
// Each reading is null when it cannot be taken; the call never rejects.
//
// Memory is the process RSS over its limit: the container's cgroup limit when
// process.constrainedMemory() gives one below the host total, else the host
// total. Disk is the share of the filesystem holding the working directory
// that is not available to the process.

const fs = require('fs');
const os = require('os');
const path = require('path');

function readMemory({ memoryUsage, constrainedMemory, totalmem }) {
  try {
    const total = Number(totalmem());
    let limit = total;
    if (typeof constrainedMemory === 'function') {
      const constrained = Number(constrainedMemory());
      if (Number.isFinite(constrained) && constrained > 0 && constrained < total) limit = constrained;
    }
    const rss = Number(memoryUsage().rss);
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(rss) || rss < 0) return null;
    return Math.min(1, rss / limit);
  } catch {
    return null;
  }
}

async function readDisk({ statfs, root }) {
  try {
    const stats = await statfs(root);
    const blocks = Number(stats.blocks);
    const bavail = Number(stats.bavail);
    if (!Number.isFinite(blocks) || blocks <= 0 || !Number.isFinite(bavail)) return null;
    return Math.min(1, Math.max(0, 1 - bavail / blocks));
  } catch {
    return null;
  }
}

async function readResourceUsage(deps = {}) {
  const memoryUsage = deps.memoryUsage || process.memoryUsage;
  const constrainedMemory = 'constrainedMemory' in deps
    ? deps.constrainedMemory
    : process.constrainedMemory;
  const totalmem = deps.totalmem || os.totalmem;
  const statfs = deps.statfs || ((p) => fs.promises.statfs(p));
  const root = deps.root || path.parse(process.cwd()).root;

  const memory = readMemory({ memoryUsage, constrainedMemory, totalmem });
  const disk = await readDisk({ statfs, root });
  return { memory, disk };
}

module.exports = { readResourceUsage };
