import React from 'react';
import { Link } from 'react-router-dom';

export default function EConsentLinkPanel() {
  return (
    <div style={{ maxWidth: 500, margin: 'auto', padding: 24 }}>
      <h2>Painel de Consentimento</h2>
      <p>Recebeu um link de consentimento por e-mail ou SMS? Clique abaixo para acessar:</p>
      <Link to="/patient/e-consent/EXEMPLO-TOKEN">Acessar Consentimento</Link>
      <p style={{ marginTop: 24 }}>
        <small>Se não recebeu, solicite ao responsável pelo projeto.</small>
      </p>
    </div>
  );
}
