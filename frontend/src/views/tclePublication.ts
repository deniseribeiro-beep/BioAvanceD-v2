// #824: the TCLE builder's post-save message. Publishing a term runs the
// backend's consent-invitation sweep (notifyPendingConsentCohort), which
// returns how many participants pending on an earlier version were invited.
// Kept out of the page so the copy rules are unit tested directly, per this
// repo's frontend testing convention.

export type ConsentNotificationCounts = {
  total: number;
  notified: number;
  failed: number;
};

export type PublicationToast = {
  level: 'success' | 'warning';
  message: string;
};

export function describeConsentPublication(
  isRevision: boolean,
  counts: ConsentNotificationCounts | undefined | null
): PublicationToast {
  const base = isRevision ? 'Nova versão criada e a anterior foi desativada.' : 'TCLE criado com sucesso.';
  if (!counts || !counts.total) {
    return { level: 'success', message: base };
  }

  const invited = `Convites de consentimento enviados: ${counts.notified} de ${counts.total} participantes pendentes.`;
  if (counts.failed > 0) {
    // #810: a partial sweep must not read as a clean publication. The tokens
    // were still minted, so the pending list's resend reaches the rest.
    return {
      level: 'warning',
      message: `${base} ${invited} ${counts.failed} falha(s) no envio -- reenvie pela lista de participantes pendentes.`,
    };
  }
  return { level: 'success', message: `${base} ${invited}` };
}
