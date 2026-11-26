const { associationFieldsOf, validateAssociation } = require('./researchResourceAssociation');

// Canonical Data Model v2.0.0 ResearchResourceCollection (P1X-0142..0146),
// RNF008 AC3 (#1496): links a Collection to the ResearchResource it belongs
// to. create() never throws: validation is the router's job.

const ENTITY = 'ResearchResourceCollection';
const TARGET = 'collectionId';

class ResearchResourceCollectionModel {
  static fieldsOf(data = {}) {
    return associationFieldsOf(data, TARGET);
  }

  static validate(data = {}) {
    return validateAssociation(data, TARGET, ENTITY);
  }

  static create(data = {}) {
    return { ...this.fieldsOf(data), createdAt: new Date(), updatedAt: new Date() };
  }
}

module.exports = ResearchResourceCollectionModel;
