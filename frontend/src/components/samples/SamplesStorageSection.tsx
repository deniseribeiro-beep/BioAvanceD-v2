import Card from '../UI/Card';
import { SampleLocator } from '../SampleLocator';

export default function SamplesStorageSection() {
  return (
    <section className="samples-storage-section">
      <div className="samples-storage-section__header">
        <div>
          <p className="samples-storage-section__eyebrow">Armazenagem Física</p>
          <h2>Alocação dinâmica e localização de amostras</h2>
          <p>
            Esta área concentra consulta operacional, rastreio físico e a nova alocação inteligente, com a posição
            exata calculada automaticamente pelo backend.
          </p>
        </div>
      </div>

      <div className="samples-storage-section__grid">
        <div className="samples-storage-section__panel">
          <Card className="samples-storage-guidance-card">
            <div className="samples-storage-guidance-card__eyebrow">Fluxo de armazenagem</div>
            <h3 className="samples-storage-guidance-card__title">A caixa é escolhida, a posição é calculada</h3>
            <p className="samples-storage-guidance-card__description">
              O operador seleciona freezer, rack e caixa. A posição final é resolvida pelo motor de alocação, que
              busca o próximo espaço livre sem expor a lógica da grade na interface.
            </p>

            <div className="samples-storage-guidance-card__steps">
              <div className="samples-storage-step">
                <span className="samples-storage-step__number">1</span>
                <div>
                  <strong>Localize a amostra</strong>
                  <p>Use o campo de busca para abrir a ficha física ou confirmar um vínculo existente.</p>
                </div>
              </div>
              <div className="samples-storage-step">
                <span className="samples-storage-step__number">2</span>
                <div>
                  <strong>Selecione a hierarquia</strong>
                  <p>Escolha freezer, rack e caixa. A posição manual deixa de ser necessária.</p>
                </div>
              </div>
              <div className="samples-storage-step">
                <span className="samples-storage-step__number">3</span>
                <div>
                  <strong>Confirme a movimentação</strong>
                  <p>A IA/Backend define a próxima posição disponível e devolve o local exato no toast.</p>
                </div>
              </div>
            </div>

            <div className="samples-storage-guidance-card__footer">
              <span className="samples-storage-guidance-card__footnote">
                Posição calculada automaticamente com integridade do grafo preservada.
              </span>
            </div>
          </Card>
        </div>

        <div className="samples-storage-section__panel">
          <SampleLocator />
        </div>
      </div>
    </section>
  );
}