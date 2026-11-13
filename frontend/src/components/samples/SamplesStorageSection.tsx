import Card from '../UI/Card';
import { SampleLocator } from '../SampleLocator';

export default function SamplesStorageSection() {
  return (
    <section className="samples-storage-section" data-testid="samples-storage-section">
      <div className="samples-storage-section__header" data-testid="samples-storage-header">
        <h2>Localização física de amostras</h2>
        <p>Consulte a posição e mova a amostra em poucos passos.</p>
      </div>

      <div className="samples-storage-section__grid" data-testid="samples-storage-grid">
        <div className="samples-storage-section__panel" data-testid="samples-storage-guidance-panel">
          <Card className="samples-storage-guidance-card">
            <div className="samples-storage-guidance-card__eyebrow">Fluxo de armazenagem</div>
            <h3 className="samples-storage-guidance-card__title">Escolha a caixa, o sistema define a posição</h3>
            <p className="samples-storage-guidance-card__description">
              Selecione freezer, rack e caixa; o destino final é resolvido automaticamente.
            </p>

            <div className="samples-storage-guidance-card__steps">
              <div className="samples-storage-step">
                <span className="samples-storage-step__number">1</span>
                <div>
                  <strong>Localize</strong>
                  <p>Abra a ficha física pelo campo de busca.</p>
                </div>
              </div>
              <div className="samples-storage-step">
                <span className="samples-storage-step__number">2</span>
                <div>
                  <strong>Selecione</strong>
                  <p>Defina freezer, rack e caixa.</p>
                </div>
              </div>
              <div className="samples-storage-step">
                <span className="samples-storage-step__number">3</span>
                <div>
                  <strong>Confirme</strong>
                  <p>A posição livre será calculada automaticamente.</p>
                </div>
              </div>
            </div>

            <div className="samples-storage-guidance-card__footer">
              <span className="samples-storage-guidance-card__footnote">A posição final é calculada pelo sistema.</span>
            </div>
          </Card>
        </div>

        <div className="samples-storage-section__panel" data-testid="samples-storage-locator-panel">
          <SampleLocator />
        </div>
      </div>
    </section>
  );
}
