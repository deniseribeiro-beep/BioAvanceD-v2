const { getCollection } = require('../utils/collectionResolver');

// RF005/RNF007 (#560): read access to ParticipantIdentity, the segregated
// civil-identity collection created by #363. Kept separate from
// PatientIdentityService.js, which resolves import-time name+DOB matches
// against `patients` and has nothing to do with this entity.
class ParticipantIdentityService {
  async getIdentityCollection(db) {
    return getCollection(db, 'participantIdentities');
  }

  async getIdentityByParticipantId(db, participantId) {
    const collection = await this.getIdentityCollection(db);
    return collection.findOne({ participantId });
  }
}

module.exports = new ParticipantIdentityService();
