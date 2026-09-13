/**
 * Pure box-occupancy-grid helpers shared between storageService.js and
 * MongoStorageRepository.js, so the position-scanning logic isn't
 * duplicated on both sides of the migration.
 */

function isPositionOccupied(occupancyGrid, position) {
  if (!occupancyGrid) {
    return false;
  }

  if (typeof occupancyGrid.has === 'function' && typeof occupancyGrid.get === 'function') {
    return Boolean(occupancyGrid.has(position) && occupancyGrid.get(position));
  }

  return Boolean(occupancyGrid[position]);
}

function getAllValidPositions(dimension) {
  const positions = [];
  const { rows, cols } = dimension;

  for (let r = 0; r < rows; r++) {
    const letter = String.fromCharCode(65 + r); // A, B, C...
    for (let c = 1; c <= cols; c++) {
      positions.push(`${letter}${c}`);
    }
  }

  return positions;
}

function findFirstAvailablePosition(box) {
  const capacityRows = Number(box?.dimension?.rows || 0);
  const capacityCols = Number(box?.dimension?.cols || 0);

  if (capacityRows < 1 || capacityCols < 1) {
    return null;
  }

  const allPositions = getAllValidPositions({ rows: capacityRows, cols: capacityCols });
  const occupancyGrid = box?.occupancyGrid || {};

  return allPositions.find((position) => !isPositionOccupied(occupancyGrid, position)) || null;
}

module.exports = {
  isPositionOccupied,
  getAllValidPositions,
  findFirstAvailablePosition
};
