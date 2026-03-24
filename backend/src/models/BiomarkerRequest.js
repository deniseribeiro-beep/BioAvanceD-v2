const { ObjectId } = require('mongodb');

class BiomarkerRequestModel {
  static collectionName = 'biomarker_requests';

  static async create(db, data) {
    const doc = {
      biomarkerName: String(data.biomarkerName || '').trim(),
      measurementUnit: String(data.measurementUnit || '').trim(),
      justification: String(data.justification || '').trim(),
      source: String(data.source || ''),
      requestedAt: data.requestedAt ? new Date(data.requestedAt) : new Date(),
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      reviewDecision: null,
      reviewComment: null,
    };
    const result = await db.collection(this.collectionName).insertOne(doc);
    return result.insertedId;
  }

  static async listPending(db) {
    return db.collection(this.collectionName).find({ status: 'pending' }).toArray();
  }

  static async approve(db, id, reviewer, comment) {
    return db.collection(this.collectionName).updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'approved', reviewedBy: reviewer, reviewedAt: new Date(), reviewDecision: 'approved', reviewComment: comment || '' } }
    );
  }

  static async reject(db, id, reviewer, comment) {
    return db.collection(this.collectionName).updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'rejected', reviewedBy: reviewer, reviewedAt: new Date(), reviewDecision: 'rejected', reviewComment: comment || '' } }
    );
  }
}

module.exports = BiomarkerRequestModel;
