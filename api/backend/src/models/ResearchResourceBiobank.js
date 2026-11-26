const { associationFieldsOf, validateAssociation } = require('./researchResourceAssociation');

// Canonical Data Model v2.0.0 ResearchResourceBiobank (P1X-0147..0151),
// RNF008 AC3 (#1496): links a Biobank to a ResearchResource it holds.
// create() never throws: validation is the router's job.

const ENTITY = 'ResearchResourceBiobank';
const TARGET = 'biobankId';

class ResearchResourceBiobankModel {
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

module.exports = ResearchResourceBiobankModel;
