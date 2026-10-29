// Attaching an external consent document to a sample. A quarantined sample
// leaves quarantine only through the evidenced release (RF019 AC5, #1315);
// any other blocked status is moved by the update itself, since the generic
// update is sticky for blocked statuses. A closed sample is final (RF026
// AC7): the document is recorded and its status is left alone, since the
// update answers 422 for any change out of closed.
export interface ExternalDocumentSampleApi {
  update: (id: number | string, data: Record<string, unknown>) => Promise<unknown>;
  releaseQuarantine: (id: number | string, data: { evidenceIds: string[]; reason?: string | null }) => Promise<unknown>;
}

export async function attachExternalDocument(
  api: ExternalDocumentSampleApi,
  sample: { id: number | string; specimenStatus?: string | null },
  { actor, reason, now = new Date() }: { actor: string | number | null; reason: string; now?: Date },
): Promise<void> {
  const status = String(sample.specimenStatus || '').toLowerCase();
  const quarantined = status === 'quarantined';
  const keepsStatus = quarantined || status === 'closed';
  await api.update(sample.id, {
    consentStatus: 'EXTERNAL_ATTACHED',
    ...(keepsStatus ? {} : { specimenStatus: 'available', quarantineReason: null }),
    importedBy: actor,
  });
  if (quarantined) {
    await api.releaseQuarantine(sample.id, {
      evidenceIds: [`external-document:${sample.id}:${now.toISOString()}`],
      reason,
    });
  }
}
