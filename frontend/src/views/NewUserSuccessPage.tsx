import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';

export default function NewUserSuccessPage() {
  const navigate = useNavigate();

  return (
    <div className="page-shell">
      <Card>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem' }}>Usuário Criado com Sucesso</h1>
          <p>Redirecionando...</p>
        </div>
      </Card>
    </div>
  );
}

