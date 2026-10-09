/**
 * Importação LGPD (#808) — a superfície do operador para o importador que
 * coloca as linhas rejeitadas em quarentena.
 *
 * Por que esta página existe: o repositório tem dois importadores. `/import`
 * (ImportForm.jsx) posta em `POST /api/import/batch`, o importador assíncrono,
 * que guarda mensagens de erro no job mas **descarta as linhas rejeitadas**
 * (#813). O importador LGPD é o único que satisfaz RNF011 AC#4 / RF029 AC#6
 * ("importações inválidas são colocadas em staging ou quarentena, sem correção
 * silenciosa") — e até aqui não tinha nenhuma tela: `importLGPDService` só era
 * usado pela página de quarentena, nunca para importar.
 *
 * O elo que faltava é o `stagingBatchId`: ele volta na resposta da importação
 * de amostras desde #787, o #794 item 2 construiu a tela que lê um lote, e
 * ninguém ligava os dois. Aqui um import parcial vira um link direto para as
 * linhas que falharam.
 *
 * Assimetrias reais que a tela mostra em vez de esconder:
 * - Só a importação de amostras coloca em quarentena. As duas de pacientes
 *   descartam as linhas rejeitadas (#814) — o resultado diz isso.
 * - (Resolvido em #815: o template CSV de pacientes passou a existir, então
 *   os dois tipos oferecem os dois formatos.)
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileWarning, FileCheck2, Upload, ShieldAlert } from 'lucide-react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { importLGPDService } from '../services/api';
import { useCreateOrganizationChoice } from '../hooks/useCreateOrganizationChoice';
import {
  availableTemplateFormats,
  summarizeImportResult,
  validateImportFile,
  type ImportSummary,
  type ImportType,
  type TemplateFormat,
} from './importLgpdFormatters';

const cellStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  verticalAlign: 'top',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
  whiteSpace: 'nowrap',
};

const TYPE_LABELS: Record<ImportType, string> = {
  patients: 'Participantes',
  samples: 'Amostras',
};

export default function ImportLGPDPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [type, setType] = useState<ImportType>('samples');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  // #1354: the organization the import stamps on what it writes. Asked only
  // when the caller has a choice (several organizations, or global scope).
  const organizationChoice = useCreateOrganizationChoice();
  const [organizationId, setOrganizationId] = useState('');

  const templateFormats = useMemo(() => availableTemplateFormats(type), [type]);

  const reset = useCallback(() => {
    setFile(null);
    setSummary(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleTypeChange = useCallback(
    (next: ImportType) => {
      setType(next);
      reset();
    },
    [reset]
  );

  const handleDownloadTemplate = useCallback(
    async (format: TemplateFormat) => {
      setError(null);
      try {
        const response = await importLGPDService.downloadTemplate(type, format);
        const blob = new Blob([response.data]);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `modelo-${type === 'patients' ? 'participantes' : 'amostras'}.${format}`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      } catch {
        setError('Não foi possível baixar o modelo.');
      }
    },
    [type]
  );

  const handleSubmit = useCallback(async () => {
    const check = validateImportFile(file);
    if (!check.ok) {
      setError(check.reason);
      setSummary(null);
      return;
    }

    if (organizationChoice.required && !organizationId) {
      setError('Selecione a organização da importação: sua conta pertence a mais de uma.');
      setSummary(null);
      return;
    }

    setBusy(true);
    setError(null);
    setSummary(null);

    try {
      const formData = new FormData();
      formData.append('file', file as File);
      if (organizationId) formData.append('organizationId', organizationId);
      const response = await importLGPDService.import(type, formData);
      setSummary(summarizeImportResult(response.data));
    } catch (err: any) {
      // A importação pode falhar inteira (arquivo ilegível, cabeçalho
      // inválido). Nesse caso não há lote nem linhas -- e desde #792 o
      // arquivo enviado é descartado quando a importação lança (#806).
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          'A importação falhou. Nenhuma linha foi processada.'
      );
    } finally {
      setBusy(false);
    }
  }, [file, type, organizationChoice.required, organizationId]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button variant="secondary" onClick={() => navigate(-1)} aria-label="Voltar">
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Importação LGPD</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Importa participantes e amostras por planilha, com anonimização e quarentena das
            linhas rejeitadas.
          </p>
        </div>
      </div>

      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>Tipo de importação</span>
            <select
              data-testid="import-lgpd-type"
              value={type}
              onChange={(event) => handleTypeChange(event.target.value as ImportType)}
              style={{ padding: '8px 10px', minWidth: 200 }}
            >
              <option value="samples">{TYPE_LABELS.samples}</option>
              <option value="patients">{TYPE_LABELS.patients}</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>Arquivo (.csv, .xlsx, .xls)</span>
            <input
              ref={fileInputRef}
              data-testid="import-lgpd-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setSummary(null);
                setError(null);
              }}
            />
          </label>

          {organizationChoice.show && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>
                Organização{organizationChoice.required ? '' : ' (opcional)'}
              </span>
              <select
                data-testid="import-lgpd-organization"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                style={{ padding: '8px 10px', minWidth: 220 }}
              >
                <option value="">{organizationChoice.required ? 'Selecione…' : 'Nenhuma'}</option>
                {organizationChoice.options.map((option) => (
                  <option key={option.organizationId} value={option.organizationId}>
                    {option.officialName || option.organizationId}
                  </option>
                ))}
              </select>
            </label>
          )}

          <Button data-testid="import-lgpd-submit" onClick={handleSubmit} disabled={busy}>
            <Upload size={16} style={{ marginRight: 6 }} />
            {busy ? 'Importando…' : 'Importar'}
          </Button>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>Modelo:</span>
          {templateFormats.map((format) => (
            <Button
              key={format}
              variant="secondary"
              data-testid={`import-lgpd-template-${format}`}
              onClick={() => handleDownloadTemplate(format)}
            >
              <Download size={14} style={{ marginRight: 6 }} />
              {format.toUpperCase()}
            </Button>
          ))}
        </div>
      </Card>

      {error && (
        <div
          data-testid="import-lgpd-error"
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 6,
            background: '#fef2f2',
            color: '#991b1b',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {summary && summary.outcome === 'unknown' && (
        <div
          data-testid="import-lgpd-unknown"
          style={{ marginTop: 16, padding: 12, background: '#fffbeb', color: '#92400e', fontSize: 14 }}
        >
          A importação respondeu em um formato não reconhecido. Confira o lote antes de reenviar —
          linhas podem ter sido gravadas.
        </div>
      )}

      {summary && summary.outcome !== 'unknown' && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {summary.outcome === 'clean' ? (
              <FileCheck2 size={20} color="#047857" />
            ) : (
              <FileWarning size={20} color="#b45309" />
            )}
            <strong data-testid="import-lgpd-counts">
              {summary.imported} de {summary.total} importadas
              {summary.rejected > 0 ? ` · ${summary.rejected} rejeitadas` : ''}
            </strong>
          </div>

          {summary.skipped > 0 && (
            <p
              data-testid="import-lgpd-skipped"
              style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}
            >
              {summary.skipped} linha{summary.skipped === 1 ? '' : 's'} em branco ignorada
              {summary.skipped === 1 ? '' : 's'}
            </p>
          )}

          {summary.duplicatesFound > 0 && (
            <p
              data-testid="import-lgpd-duplicates"
              style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}
            >
              {summary.duplicatesFound} duplicata{summary.duplicatesFound === 1 ? '' : 's'} encontrada
              {summary.duplicatesFound === 1 ? '' : 's'}
            </p>
          )}

          {summary.outcome === 'partial' && summary.quarantineHref && (
            <div style={{ marginBottom: 12 }}>
              <Button
                data-testid="import-lgpd-quarantine-link"
                onClick={() => navigate(summary.quarantineHref as string)}
              >
                Revisar linhas rejeitadas
              </Button>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6b7280' }}>
                As linhas rejeitadas foram mantidas em quarentena com o arquivo enviado. Nada foi
                corrigido automaticamente.
              </p>
            </div>
          )}

          {summary.outcome === 'partial-unretained' && (
            <div
              data-testid="import-lgpd-unretained"
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 6,
                background: '#fffbeb',
                color: '#92400e',
                fontSize: 13,
                display: 'flex',
                gap: 8,
              }}
            >
              <ShieldAlert size={18} style={{ flexShrink: 0 }} />
              <span>
                Esta importação <strong>não</strong> mantém as linhas rejeitadas em quarentena — a
                lista abaixo é a única cópia. Copie o que precisar antes de sair da página (#814).
              </span>
            </div>
          )}

          {summary.rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={headStyle}>Linha</th>
                    <th style={headStyle}>Participante</th>
                    <th style={headStyle}>Erros</th>
                  </tr>
                </thead>
                <tbody data-testid="import-lgpd-rejected-rows">
                  {summary.rows.map((row, index) => (
                    <tr key={`${row.row ?? 'x'}-${index}`}>
                      <td style={cellStyle}>{row.row ?? '—'}</td>
                      <td style={cellStyle}>{row.participantId ?? '—'}</td>
                      <td style={cellStyle}>{row.errors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
