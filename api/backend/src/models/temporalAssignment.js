// The append-only temporal assignments of the normalized physical chain
// (SpecimenContainerAssignment, ContainerPositionAssignment,
// RackLocationAssignment) each run over a half-open interval [from, to):
// RF016 AC3, RF017 AC4, RULE-030, RULE-035. An open interval (no end) runs
// on indefinitely, and [a, b) and [b, c) do not overlap.

function overlaps(a, b, { from, to }) {
  const aEnd = a[to] ? new Date(a[to]).getTime() : Infinity;
  const bEnd = b[to] ? new Date(b[to]).getTime() : Infinity;
  return new Date(a[from]).getTime() < bEnd && new Date(b[from]).getTime() < aEnd;
}

// Refuses a candidate whose interval overlaps another assignment sharing any
// of `keys` (one container at a time, one position at a time, ...).
function findConflict(candidate, existing, { idField, from, to, keys }) {
  for (const other of existing) {
    if (other[idField] === candidate[idField]) continue;
    const key = keys.find((k) => candidate[k] && other[k] === candidate[k]);
    if (key && overlaps(candidate, other, { from, to })) {
      return { other, key };
    }
  }
  return null;
}

function assertEndAfterStart(start, end) {
  if (end && new Date(end) <= new Date(start)) {
    throw new Error('o fim do intervalo deve ser posterior ao início ([início, fim))');
  }
}

module.exports = { overlaps, findConflict, assertEndAfterStart };
