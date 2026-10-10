// Attaching an external consent document to a sample. A quarantined sample
// leaves quarantine only through the evidenced release (RF019 AC5, #1315);
// any other blocked status is moved by the update itself, since the generic
// update is sticky for blocked statuses.
export interface ExternalDocumentSampleApi {
  update: (id: number | string, data: Record<string, unknown>) => Promise<unknown>;
  releaseQuarantine: (id: number | string, data: { evidenceIds: string[]; reason?: string | null }) => Promise<unknown>;
}

export async function attachExternalDocument(
  api: ExternalDocumentSampleApi,
  sample: { id: number | string; specimenStatus?: string | null },
  { actor, reason, now = new Date() }: { actor: string | number | null; reason: string; now?: Date },
): Promise<void> {
  const quarantined = String(sample.specimenStatus || '').toLowerCase() === 'quarantined';
  await api.update(sample.id, {
    consentStatus: 'EXTERNAL_ATTACHED',
    ...(quarantined ? {} : { specimenStatus: 'available', quarantineReason: null }),
    importedBy: actor,
  });
  if (quarantined) {
    await api.releaseQuarantine(sample.id, {
      evidenceIds: [`external-document:${sample.id}:${now.toISOString()}`],
      reason,
    });
  }
}
