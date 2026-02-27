export type TranslatorFn = (key: string, fallback?: string) => string;

export function mapMovementTypeLabel(type: string, t: TranslatorFn): string {
  if (!type || type === '—') return '—';

  const normalizedType = type.toLowerCase();
  const labels: Record<string, string> = {
    withdraw: t('samples.withdraw', 'Retirada'),
    return: t('samples.return', 'Devolução'),
    transfer: t('samples.transfer', 'Transferência'),
  };

  return labels[normalizedType] || type;
}
