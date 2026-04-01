import React from 'react';
import { CheckCircle, AlertTriangle } from 'lucide-react';

export default function MiabisBadge({ result }) {
  if (!result) return null;
  const { isCompliant, missingFields = [], consentStatus } = result;
  if (isCompliant) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', color: '#22c55e', gap: 8, fontWeight: 600 }}>
        <CheckCircle size={18} color="#22c55e" />
        MIABIS Compliant
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', color: '#eab308', gap: 8, fontWeight: 500, flexDirection: 'column', background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, padding: 8, margin: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={18} color="#eab308" />
        <span>MIABIS: Correções necessárias para compartilhamento internacional</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 24, color: '#92400e', fontWeight: 400, fontSize: 14 }}>
        {missingFields.map(f => <li key={f}>{f}</li>)}
        {consentStatus !== 'valid' && <li>Consentimento inválido ou ausente</li>}
      </ul>
    </div>
  );
}
