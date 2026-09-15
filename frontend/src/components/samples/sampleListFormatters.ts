import type { Sample } from '../../types/models';

export type TranslatorFn = (key: string, fallback?: string) => string;

export function getStorageLabel(sample: Sample, t: TranslatorFn) {
  const placement = sample.currentStoragePlacement;
  const boxName = placement?.box?.boxName
    ? String(placement.box.boxName)
    : placement?.boxName
      ? String(placement.boxName)
      : placement?.boxId
        ? String(placement.boxId)
        : '';
  const position = placement?.box?.position
    ? String(placement.box.position)
    : placement?.positionCode
      ? String(placement.positionCode)
      : '';
  const path = placement?.path && placement.path !== 'N/A' ? String(placement.path) : '';

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
