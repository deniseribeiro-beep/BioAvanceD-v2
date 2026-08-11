import type { Sample } from '../../types/models';

export type TranslatorFn = (key: string, fallback?: string) => string;

// #517: reads the batched resolvedStorageLocation GET /samples now embeds
// per sample (same SampleStorageLocationDTO shape GET /storage/sample/:sampleId
// returns), instead of the legacy sample.storageLocation embedded field.
export function getStorageLabel(sample: Sample, t: TranslatorFn) {
  const resolvedLocation = sample.resolvedStorageLocation;
  const boxName = resolvedLocation?.box?.boxName ? String(resolvedLocation.box.boxName) : '';
  const position = resolvedLocation?.box?.position ? String(resolvedLocation.box.position) : '';
  const path = resolvedLocation?.path && resolvedLocation.path !== 'N/A' ? String(resolvedLocation.path) : '';

  if (!boxName && !path && !position) {
    return t('samples.storage.awaiting', 'Aguardando Armazenagem');
  }

  if (path) {
    return position ? `${path} / ${t('samples.storage.position', 'Posição')} ${position}` : path;
  }

  if (boxName) {
    return position ? `${boxName} / ${t('samples.storage.position', 'Posição')} ${position}` : boxName;
  }

  if (position) {
    return `${t('samples.storage.position', 'Posição')} ${position}`;
  }

  return t('samples.storage.definedBox', 'Caixa definida');
}

// #517/#518: reads the batched currentSpecimenPreanalytics GET /samples now
// embeds per sample (sealed-pinned if set, else newest — see
// specimen-preanalytics.service.js's getCurrentProfilesForSpecimens),
// instead of the legacy embedded sample.sprec object. Shared by the list
// view (SamplesPageView) and the details view (SampleDetailsPage) — both
// source their `samples` array from the same GET /samples call.
export function buildSprecSummary(sample: Sample, t: TranslatorFn) {
  const profile = sample.currentSpecimenPreanalytics;
  if (!profile) {
    return t('samples.sprec.na', 'SPREC: N/A');
  }

  const matrixType = String(profile.matrixType || '').trim().toLowerCase();
  const fields = matrixType === 'solid'
    ? [profile.sampleType, profile.primaryContainer, profile.warmIschemiaTime, profile.coldIschemiaTime, profile.fixationStabilizationType, profile.fixationTime, profile.longTermStorage]
    : [profile.sampleType, profile.primaryContainer, profile.preCentrifugation, profile.centrifugation, profile.secondCentrifugation, profile.postCentrifugationDelay, profile.longTermStorage];
  const code = String(profile.sprecCode || fields.map((part) => String(part || '').trim()).filter(Boolean).join('-')).trim();
  if (!code) {
    return t('samples.sprec.na', 'SPREC: N/A');
  }

  return `${t('samples.sprec.prefix', 'SPREC')} ${code}`;
}

// #518 (SampleDetailsPage.tsx's per-axis SPREC breakdown, the sibling
// migration to buildSprecSummary above): same currentSpecimenPreanalytics
// source, formatted as one `Label:value` pair per SPREC axis instead of a
// single dash-joined code.
export function buildSprecAxisSummary(sample: Sample, t: TranslatorFn) {
  const profile = sample.currentSpecimenPreanalytics;
  const notAvailable = t('common.notAvailable', 'N/A');
  const matrixType = String(profile?.matrixType || '').trim().toLowerCase();

  const axes = matrixType === 'solid'
    ? [
      [t('samples.detail.sprec.axes.Pwarm', 'Pwarm'), profile?.warmIschemiaTime],
      [t('samples.detail.sprec.axes.Pcold', 'Pcold'), profile?.coldIschemiaTime],
      [t('samples.detail.sprec.axes.Pfix', 'Pfix'), profile?.fixationStabilizationType],
      [t('samples.detail.sprec.axes.PfixTime', 'PfixTime'), profile?.fixationTime],
      [t('samples.detail.sprec.axes.Pstore', 'Pstore'), profile?.longTermStorage],
    ]
    : [
      [t('samples.detail.sprec.axes.Ppre', 'Ppre'), profile?.preCentrifugation],
      [t('samples.detail.sprec.axes.Pcent1', 'Pcent1'), profile?.centrifugation],
      [t('samples.detail.sprec.axes.Pcent2', 'Pcent2'), profile?.secondCentrifugation],
      [t('samples.detail.sprec.axes.Ppost', 'Ppost'), profile?.postCentrifugationDelay],
      [t('samples.detail.sprec.axes.Pstore', 'Pstore'), profile?.longTermStorage],
    ];

  return axes
    .map(([label, value]) => `${label}:${String(value || '').trim() || notAvailable}`)
    .join(' | ');
}
