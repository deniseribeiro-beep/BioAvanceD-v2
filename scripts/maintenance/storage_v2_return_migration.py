from pathlib import Path


def replace_once(path, old, new, label):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'api/backend/src/infrastructure/persistence/mongo/MongoStorageRepository.js',
    """    await this.assignCanonicalPhysicalPlacement({
      specimenId: sample.specimenId || sample._id,
      boxId: boxObjId,
      positionCode: position
    }, session);
    return position;""",
    """    return this.assignCanonicalPhysicalPlacement({
      specimenId: sample.specimenId || sample._id,
      boxId: boxObjId,
      positionCode: position
    }, session);""",
    'MongoStorageRepository.autoAssignSamplePosition'
)

service_path = Path('api/backend/src/services/storageService.js')
service = service_path.read_text(encoding='utf-8')
start = service.index('  async autoAssignSampleToBox(')
end = service.index('\n  async releaseSampleFromPosition(', start)
block = service[start:end]
replacements = [
    ('      let assignedPosition = null;', '      let currentStoragePlacement = null;'),
    ('        assignedPosition = await this.storageRepository.autoAssignSamplePosition(', '        currentStoragePlacement = await this.storageRepository.autoAssignSamplePosition('),
    ('            physicalStorage: { boxId: String(boxObjId), position: assignedPosition }', '            physicalStorage: { boxId: String(boxObjId), position: currentStoragePlacement.positionCode }'),
    ("          to: { boxId: String(boxObjId), position: assignedPosition },", "          to: { boxId: String(boxObjId), position: currentStoragePlacement.positionCode },"),
    ('      logger.info(`✅ Alocação inteligente realizada para amostra ${specimenId} em ${boxId}/${assignedPosition}`);', '      logger.info(`✅ Alocação inteligente realizada para amostra ${specimenId} em ${boxId}/${currentStoragePlacement.positionCode}`);'),
    ("""        sampleLocation: {
          specimenId: String(sampleObjId),
          boxId: String(boxObjId),
          position: assignedPosition
        }""", '        currentStoragePlacement')
]
for old, new in replacements:
    count = block.count(old)
    if count != 1:
        raise SystemExit(f'storageService.autoAssignSampleToBox token {old!r}: expected 1, found {count}')
    block = block.replace(old, new, 1)
service_path.write_text(service[:start] + block + service[end:], encoding='utf-8')

replace_once(
    'api/backend/src/interface/controllers/auto-assign-sample.controller.js',
    """      return res.status(201).json({
        success: true,
        data: result.sampleLocation,
        message: `Amostra alocada automaticamente na Posição ${result.sampleLocation.position}`,
        projectionQueued: result.projectionQueued === true,
        projectionEventId: result.projectionEventId || null
      });""",
    """      const currentStoragePlacement = result.currentStoragePlacement || null;
      return res.status(201).json({
        success: true,
        data: currentStoragePlacement,
        currentStoragePlacement,
        message: currentStoragePlacement?.positionCode
          ? `Amostra alocada automaticamente na Posição ${currentStoragePlacement.positionCode}`
          : 'Amostra alocada automaticamente',
        projectionQueued: result.projectionQueued === true,
        projectionEventId: result.projectionEventId || null
      });""",
    'auto-assign-sample.controller'
)

Path(__file__).unlink()
