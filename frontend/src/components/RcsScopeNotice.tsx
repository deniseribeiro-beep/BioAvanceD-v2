// RF018 AC11 (#1320): what an RCS result is and is not, shown wherever the UI
// shows an RCS grade or score. Mirrors RCS_SCOPE_STATEMENT in
// api/backend/src/services/rcs-certification.service.js, the last
// justification of every RCSAssessment; no shared constant exists across the
// frontend/backend split.
export const RCS_SCOPE_NOTICE = 'O RCS qualifica o histórico pré-analítico da amostra para o contexto de uso declarado; não é validade clínica, qualidade analítica do ensaio nem medida universal de qualidade.';

export default function RcsScopeNotice() {
  return (
    <p role="note" data-testid="rcs-scope-notice" style={{ fontSize: 12, margin: '4px 0 0', opacity: 0.8 }}>
      {RCS_SCOPE_NOTICE}
    </p>
  );
}
