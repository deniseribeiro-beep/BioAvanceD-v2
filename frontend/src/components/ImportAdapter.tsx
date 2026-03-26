import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export type ImportDTO = {
  identificador: string;
  nomePaciente: string;
  diagnostico?: string;
  tipoAmostra?: string;
  volume?: string;
  tipoImportacao: 'NOVO_CADASTRO' | 'ATUALIZACAO_AMOSTRA';
  tcleId?: string;
  tcleStatus?: string;
  aceitaGenetica?: boolean;
  aceitaPartilha?: boolean;
  email: string;
};

const SYSTEM_FIELDS: { key: keyof ImportDTO; label: string; required?: boolean }[] = [
  { key: 'identificador', label: 'Identificador (CPF/Passaporte/Prontuário)', required: true },
  { key: 'nomePaciente', label: 'Nome do Paciente', required: true },
  { key: 'diagnostico', label: 'Diagnóstico' },
  { key: 'tipoAmostra', label: 'Tipo de Amostra' },
  { key: 'volume', label: 'Volume' },
  { key: 'tipoImportacao', label: 'Tipo de Importação', required: true },
  { key: 'tcleId', label: 'ID do TCLE' },
  { key: 'tcleStatus', label: 'Status do TCLE' },
  { key: 'aceitaGenetica', label: 'Aceita Genética' },
  { key: 'aceitaPartilha', label: 'Aceita Partilha' },
  { key: 'email', label: 'E-mail', required: true },
];

const IGNORED_FIELDS = ['telefone', 'celular', 'whatsapp'];

function normalizeHeader(header: string) {
  return header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[0-]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isIgnoredField(header: string) {
  const norm = normalizeHeader(header);
  return IGNORED_FIELDS.some(f => norm.includes(f));
}

type Mapping = { [systemField: string]: string };

export default function ImportAdapter({
  onSubmit,
}: {
  onSubmit: (data: ImportDTO[]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [preview, setPreview] = useState<ImportDTO[]>([]);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);

  // 1. Leitura e Parse do Arquivo
  const handleFile = async (f: File) => {
    setFile(f);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setPreview([]);
    setErrors([]);

    if (f.name.endsWith('.csv')) {
      Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          setHeaders(result.meta.fields || []);
          setRows(result.data as any[]);
        },
      });
    } else if (f.name.endsWith('.xlsx')) {
      const data = await f.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      setHeaders(Object.keys(json[0] || {}));
      setRows(json as any[]);
    }
  };

  // 2. Mapeamento Visual
  const handleMappingChange = (systemField: string, fileColumn: string) => {
    setMapping((prev) => ({ ...prev, [systemField]: fileColumn }));
  };

  // 3. Preview e Conversão
  const handlePreview = () => {
    const newPreview: ImportDTO[] = [];
    const newErrors: { row: number; message: string }[] = [];

    rows.forEach((row, idx) => {
      // Ignorar campos de telefone/celular/whatsapp
      const cleanRow: any = {};
      for (const col of headers) {
        if (!isIgnoredField(col)) {
          cleanRow[col] = row[col];
        }
      }

      const dto: any = {};
      let hasError = false;

      for (const field of SYSTEM_FIELDS) {
        const col = mapping[field.key];
        if (col) {
          let value = cleanRow[col];
          // Regras de conversão
          if (field.key === 'aceitaGenetica' || field.key === 'aceitaPartilha') {
            value = value === 'true' || value === true || value === '1' ? true : false;
          }
          if (field.key === 'tipoImportacao') {
            value =
              value === 'NOVO_CADASTRO' || value === 'ATUALIZACAO_AMOSTRA'
                ? value
                : 'NOVO_CADASTRO';
          }
          dto[field.key] = value;
        }
        if (field.required && (!col || !cleanRow[col])) {
          hasError = true;
          newErrors.push({
            row: idx + 1,
            message: `Campo obrigatório "${field.label}" ausente ou vazio.`,
          });
        }
      }

      // E-mail obrigatório para novos cadastros
      if (
        dto.tipoImportacao === 'NOVO_CADASTRO' &&
        (!dto.email || String(dto.email).trim() === '')
      ) {
        hasError = true;
        newErrors.push({
          row: idx + 1,
          message: 'E-mail obrigatório para novos cadastros.',
        });
      }

      if (!hasError) newPreview.push(dto as ImportDTO);
    });

    setPreview(newPreview);
    setErrors(newErrors);
  };

  // 4. Envio do Payload
  const handleSubmit = () => {
    onSubmit(preview);
  };

  return (
    <div>
      <h2>Importação de Dados (Adapter ETL Visual)</h2>
      <input
        type="file"
        accept=".csv,.xlsx"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFile(e.target.files[0]);
        }}
        title="Selecione um arquivo CSV ou XLSX para importar"
        placeholder="Selecione um arquivo CSV ou XLSX para importar"
      />
      {headers.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Mapeamento de Colunas</h3>
          <table>
            <thead>
              <tr>
                <th>Campo do Sistema</th>
                <th>Coluna do Arquivo</th>
              </tr>
            </thead>
            <tbody>
              {SYSTEM_FIELDS.map((field) => (
                <tr key={field.key}>
                  <td>
                    {field.label}
                    {field.required && <span style={{ color: 'red' }}> *</span>}
                  </td>
                  <td>
                    <select
                      value={mapping[field.key] || ''}
                      onChange={(e) =>
                        handleMappingChange(field.key, e.target.value)
                      }
                      title={`Mapeie para o campo do sistema: ${field.label}`}
                    >
                      <option value="">-- Não Mapear --</option>
                      {headers
                        .filter((h) => !isIgnoredField(h))
                        .map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={{ marginTop: 16 }} onClick={handlePreview}>
            Gerar Preview
          </button>
        </div>
      )}
      {preview.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3>Preview dos Dados Convertidos</h3>
          <table border={1} cellPadding={4}>
            <thead>
              <tr>
                {SYSTEM_FIELDS.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, idx) => (
                <tr key={idx}>
                  {SYSTEM_FIELDS.map((f) => (
                    <td key={f.key}>{String((row as any)[f.key] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button style={{ marginTop: 16 }} onClick={handleSubmit}>
            Enviar para Importação
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div style={{ marginTop: 24, color: 'red' }}>
          <h4>Erros de Validação</h4>
          <ul>
            {errors.map((err, idx) => (
              <li key={idx}>
                Linha {err.row}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
