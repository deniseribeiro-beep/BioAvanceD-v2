import { Bold, Italic, List, ListOrdered, Plus, Type, Underline, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { cn } from '../lib/cn';

export function TcleBuilderPage() {
  const { templateId } = useParams();
  const editing = Boolean(templateId);
  const [tab, setTab] = useState<'editor' | 'history'>('editor');
  const [items, setItems] = useState([
    { id: '1', label: 'Aceito ceder minhas amostras para estudos genéticos', required: true },
    { id: '2', label: 'Autorizo contato futuro para novas finalidades', required: false },
  ]);

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Gestão de Consentimento"
        title="Construtor de TCLE"
        subtitle="Cabeçalho e aceite fixos · corpo e itens granulares editáveis · vigência manual"
        actions={
          <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            {editing ? 'Publicar nova versão' : 'Salvar e publicar'}
          </button>
        }
      />

      <div className="flex gap-1 rounded-xl border border-border bg-white p-1">
        {([
          ['editor', 'Edição do TCLE'],
          ['history', 'Histórico de Versões'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn('rounded-lg px-3 py-2 text-sm font-medium', tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <div className="card-surface">
          <h2 className="mb-3 text-base font-semibold">Versões do modelo</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between rounded-md border border-primary/20 bg-primary-soft px-3 py-2"><span>v3 · ativa</span><span>2026-11-01</span></li>
            <li className="flex justify-between rounded-md border border-border px-3 py-2"><span>v2 · obsoleta</span><span>2026-08-12</span></li>
            <li className="flex justify-between rounded-md border border-border px-3 py-2"><span>v1 · obsoleta</span><span>2026-03-04</span></li>
          </ul>
          {editing ? <p className="mt-3 text-xs text-muted-foreground">Editando template <code>{templateId}</code></p> : null}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="card-surface grid gap-4 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Nome do Modelo</span>
              <input className="w-full rounded-md border border-border px-3 py-2" defaultValue={editing ? 'TCLE Biobanco Genômico' : ''} placeholder="Ex.: TCLE Biobanco Genômico" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">CAAE</span>
              <input className="w-full rounded-md border border-border px-3 py-2" defaultValue="12345678.9.0000.0000" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Modalidade</span>
              <select className="w-full rounded-md border border-border px-3 py-2" defaultValue="dynamic">
                <option value="specific">Específico</option>
                <option value="broad">Amplo</option>
                <option value="tiered">Escalonado</option>
                <option value="dynamic">Dinâmico</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Início da vigência</span>
              <input type="date" className="w-full rounded-md border border-border px-3 py-2" defaultValue="2026-11-01" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Fim da vigência</span>
              <input type="date" className="w-full rounded-md border border-border px-3 py-2" defaultValue="2028-11-01" />
            </label>
          </div>

          <div className="space-y-3">
            <section className="card-surface border-dashed">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bloco 1 · Cabeçalho fixo</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-foreground">BIOBANCO INSTITUCIONAL — TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO{'\n'}Título: {'{'}nome do modelo{'}'} · CAAE: {'{'}caae{'}'}</pre>
            </section>

            <section className="card-surface">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bloco 2 · Corpo explicativo</p>
                  <h2 className="text-base font-semibold">Corpo do Termo</h2>
                </div>
                <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">Editor rico</span>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {[Bold, Italic, Underline, List, ListOrdered, Type].map((Icon, i) => (
                  <button key={i} type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <div
                className="min-h-[140px] rounded-md border border-border bg-white p-3 text-sm leading-relaxed"
                contentEditable
                suppressContentEditableWarning
              >
                Este termo descreve a coleta, armazenamento e uso futuro de amostras biológicas no âmbito do biobanco, em conformidade com a Resolução CNS 441/2011 e a LGPD.
              </div>
            </section>

            <section className="card-surface">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bloco 3 · Consentimentos granulares</p>
                  <h2 className="text-base font-semibold">Itens de Aceite</h2>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium"
                  onClick={() => setItems((prev) => [...prev, { id: String(Date.now()), label: '', required: false }])}
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </button>
              </div>
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={item.id} className="rounded-lg border border-border p-3">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">Texto do consentimento</span>
                      <input
                        className="w-full rounded-md border border-border px-3 py-2"
                        value={item.label}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, label: e.target.value } : x)))}
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={item.required} onChange={(e) => setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, required: e.target.checked } : x)))} />
                        Obrigatório · item {index + 1}
                      </label>
                      <button type="button" className="inline-flex items-center gap-1 text-xs text-danger" onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}>
                        <X className="h-3.5 w-3.5" /> Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card-surface border-dashed">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bloco 4 · Aceite e assinaturas</p>
              <p className="mt-2 text-sm">Declaro que li e compreendi este termo e consinto de forma livre e esclarecida.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 text-sm">
                <div><div className="mb-6 border-b border-foreground/40" /><strong>Participante / Responsável</strong></div>
                <div><div className="mb-6 border-b border-foreground/40" /><strong>Pesquisador responsável</strong></div>
              </div>
            </section>
          </div>

          <p className="text-xs text-muted-foreground">
            Após publicar, o sistema dispara convites aos participantes. Ver também{' '}
            <Link className="text-primary underline" to="/consents">/consents</Link> e ações em{' '}
            <Link className="text-primary underline" to="/patients">/patients</Link>.
          </p>
        </form>
      )}
    </div>
  );
}
