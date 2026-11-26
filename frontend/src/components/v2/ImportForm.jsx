import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Info } from 'lucide-react';
import Button from '../UI/Button';
import { stageFhirBundle, uploadBatch } from '../../api/import.service';
import { IMPORT_FILE_RULES, VALIDATION_MESSAGES } from '../../config/constants/validation.constants';
import { convertExcelFileToFhirBundle, downloadFhirExcelTemplate } from '../../utils/fhirExcelImport';
import BatchProgressViewer from './BatchProgressViewer';

const fileSchema = z
  .instanceof(File, { message: 'Selecione um arquivo para importação em lote' })
  .refine((file) => {
    const extension = file.name.toLowerCase().split('.').pop();
    return Boolean(extension) && IMPORT_FILE_RULES.allowedExtensions.includes(extension);
  }, { message: 'Formato inválido. Use CSV, TXT, XLSX ou JSON.' })
  .refine((file) => file.size > 0, { message: 'O arquivo não pode estar vazio' })
  .refine((file) => file.size <= IMPORT_FILE_RULES.maxSizeBytes, { message: 'O arquivo excede o tamanho máximo permitido' });

const formSchema = z.object({
  file: fileSchema,
});

function getFieldError(error) {
  return error?.issues?.[0]?.message || '';
}

/**
 * @param {{ onSuccess?: (data: unknown) => void, onError?: (message: string) => void, className?: string }} props
 */
export default function ImportForm({ onSuccess, onError, className = '' }) {
  const [file, setFile] = useState(null);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [excelFile, setExcelFile] = useState(null);
  const [jsonFile, setJsonFile] = useState(null);
  const [convertedBundle, setConvertedBundle] = useState(null);
  const [fhirPreview, setFhirPreview] = useState('');
  const [fhirStatus, setFhirStatus] = useState('');
  const [fhirError, setFhirError] = useState('');
  const [fhirBusy, setFhirBusy] = useState(false);

  const validation = useMemo(() => formSchema.safeParse({ file }), [file]);
  const isValid = validation.success;
  const fileError = touched && !validation.success ? getFieldError(validation.error) : '';

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setTouched(true);
    setFile(nextFile);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched(true);

    const parsed = formSchema.safeParse({ file });
    if (!parsed.success) {
      onError?.(getFieldError(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      const response = await uploadBatch(parsed.data.file);
      const payload = response?.data?.data || response?.data || {};
      const jobId = String(payload.jobId || '').trim();

      if (!jobId) {
        throw new Error('O backend não retornou um jobId para acompanhar a importação');
      }

      onSuccess?.(response.data);
      setActiveJob({
        jobId,
        fileName: payload.fileName || parsed.data.file.name,
      });
    } catch (error) {
      const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || VALIDATION_MESSAGES.required;
      onError?.(message);
    } finally {
      setSubmitting(false);
    }
  };

  const downloadJsonPreview = (bundle) => {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'importacao-fhir-bundle.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExcelConversion = async () => {
    setFhirError('');
    setFhirStatus('');

    if (!excelFile) {
      setFhirError('Selecione um arquivo Excel preenchido com o modelo antes de converter.');
      return;
    }

    setFhirBusy(true);
    try {
      const bundle = await convertExcelFileToFhirBundle(excelFile);
      setConvertedBundle(bundle);
      setFhirPreview(JSON.stringify(bundle, null, 2));
      setFhirStatus('Excel convertido para JSON FHIR. Revise o preview antes de importar.');
      downloadJsonPreview(bundle);
    } catch (error) {
      setConvertedBundle(null);
      setFhirPreview('');
      setFhirError(error?.message || 'Não foi possível converter o Excel para JSON FHIR.');
    } finally {
      setFhirBusy(false);
    }
  };

  const parseJsonFile = async () => {
    if (!jsonFile) return null;
    const text = await jsonFile.text();
    return JSON.parse(text);
  };

  const handleFhirImport = async () => {
    setFhirError('');
    setFhirStatus('');
    setFhirBusy(true);

    try {
      const bundle = convertedBundle || (await parseJsonFile());

      if (!bundle) {
        throw new Error('Converta um Excel ou selecione um JSON FHIR antes de importar.');
      }

      const response = await stageFhirBundle(bundle);
      const payload = response?.data?.data || response?.data || {};
      const batchId = payload.batchId || payload.batch?._id || payload.batch?.id;
      const counters = payload.counters || payload.batch?.counters || {};
      setFhirStatus(`JSON FHIR enviado para staging${batchId ? ` (lote ${batchId})` : ''}. Válidos: ${counters.valid ?? 0}. Erros: ${counters.error ?? 0}. Pendentes: ${counters.pendingConsent ?? 0}.`);
      onSuccess?.(response.data);
    } catch (error) {
      const message = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Não foi possível importar o JSON FHIR.';
      setFhirError(message);
      onError?.(message);
    } finally {
      setFhirBusy(false);
    }
  };

  return (
    activeJob ? (
      <BatchProgressViewer
        className={className}
        jobId={activeJob.jobId}
        fileName={activeJob.fileName}
        onReset={() => {
          setActiveJob(null);
          setFile(null);
          setTouched(false);
          setSubmitting(false);
        }}
      />
    ) : (
      <>
        <section
          className={className}
          style={{
            display: 'grid',
            gap: '1rem',
            marginBottom: '1rem',
          }}
          aria-label="Importação FHIR por Excel"
        >
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
              <Button type="button" onClick={downloadFhirExcelTemplate} data-testid="fhir-excel-template-button">
                Baixar modelo Excel
              </Button>

              <label htmlFor="fhir-excel-file" style={{ fontWeight: 600, color: 'var(--text)' }}>
                Excel preenchido
              </label>
              <input
                id="fhir-excel-file"
                data-testid="fhir-excel-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  setExcelFile(event.target.files?.[0] || null);
                  setFhirError('');
                  setFhirStatus('');
                }}
                style={{
                  maxWidth: '18rem',
                  padding: '0.65rem',
                  borderRadius: '0.7rem',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />

              <Button type="button" onClick={handleExcelConversion} disabled={fhirBusy} data-testid="fhir-excel-convert-button">
                Converter Excel para JSON FHIR
              </Button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
              <label htmlFor="fhir-json-file" style={{ fontWeight: 600, color: 'var(--text)' }}>
                JSON FHIR
              </label>
              <input
                id="fhir-json-file"
                data-testid="fhir-json-input"
                type="file"
                accept=".json,application/json,application/fhir+json"
                onChange={(event) => {
                  setJsonFile(event.target.files?.[0] || null);
                  setFhirError('');
                  setFhirStatus('');
                }}
                style={{
                  maxWidth: '18rem',
                  padding: '0.65rem',
                  borderRadius: '0.7rem',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />

              <Button type="button" onClick={handleFhirImport} disabled={fhirBusy} data-testid="fhir-json-import-button">
                Importar JSON FHIR
              </Button>
            </div>

            {fhirError && (
              <div role="alert" data-testid="fhir-excel-error" style={{ color: 'var(--danger)', fontSize: '0.88rem', fontWeight: 600 }}>
                {fhirError}
              </div>
            )}

            {fhirStatus && (
              <div data-testid="fhir-staging-result" style={{ color: 'var(--success, #047857)', fontSize: '0.88rem', fontWeight: 600 }}>
                {fhirStatus}
              </div>
            )}

            {fhirPreview && (
              <textarea
                data-testid="fhir-json-preview"
                readOnly
                value={fhirPreview}
                rows={8}
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: '0.78rem',
                  borderRadius: '0.75rem',
                  border: '1px solid var(--border)',
                  padding: '0.8rem',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
            )}
          </div>
        </section>

        <form className={className} onSubmit={handleSubmit} noValidate>
          <div
            style={{
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: 'minmax(0, 1.15fr) minmax(280px, 0.85fr)',
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <label htmlFor="import-batch-file" style={{ fontWeight: 600, color: 'var(--text)' }}>
                Arquivo para importação em lote
              </label>

              <input
                id="import-batch-file"
                name="file"
                type="file"
                accept={IMPORT_FILE_RULES.allowedExtensions.map((ext) => `.${ext}`).join(',')}
                onChange={handleFileChange}
                onBlur={() => setTouched(true)}
                aria-invalid={Boolean(fileError)}
                aria-describedby={fileError ? 'import-batch-file-error' : 'import-batch-file-help'}
                style={{
                  width: '100%',
                  padding: '0.8rem',
                  borderRadius: '0.9rem',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />

              <div id="import-batch-file-help" style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                Formatos aceitos: CSV, TXT, XLSX e JSON. Tamanho máximo: 100 MB.
              </div>

              {fileError && (
                <div id="import-batch-file-error" role="alert" style={{ color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>
                  {fileError}
                </div>
              )}
            </div>

            <aside
              style={{
                display: 'grid',
                gap: '0.8rem',
                padding: '1rem',
                borderRadius: '1rem',
                border: '1px solid rgba(15, 118, 110, 0.16)',
                background: 'linear-gradient(180deg, rgba(240,253,250,0.95), rgba(255,255,255,1))',
                boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
              }}
            >
              <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '2.25rem',
                    height: '2.25rem',
                    borderRadius: '0.75rem',
                    background: 'rgba(15, 118, 110, 0.12)',
                    color: 'var(--primary)',
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                >
                  <Info size={18} />
                </div>

                <div style={{ display: 'grid', gap: '0.25rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)' }}>Instruções</div>
                  <div style={{ fontSize: '0.88rem', color: 'var(--text-light)', lineHeight: 1.5 }}>
                    Envie apenas arquivos válidos no formato aceito. O processamento continua em segundo plano e o progresso aparece automaticamente.
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.86rem', color: 'var(--text-light)' }}>
                <div>• Formatos aceitos: CSV, TXT, XLSX e JSON.</div>
                <div>• Tamanho máximo: 100 MB.</div>
                <div>• O arquivo precisa conter linhas válidas para processamento.</div>
                <div>• Mantenha o cabeçalho consistente com o exportador do sistema.</div>
              </div>
            </aside>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <Button type="submit" disabled={!isValid || submitting}>
              {submitting ? 'Enviando...' : 'Enviar'}
            </Button>
          </div>
        </form>
      </>
    )
  );
}
