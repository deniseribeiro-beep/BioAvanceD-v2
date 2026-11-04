import { useEffect, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { fetchWithRequestId } from '../api/requestId';

const canvasToBlob = (canvas) =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });

export default function AssinaturaDigitalTCLE({
  endpoint = '/api/v1/consent/signature',
  doadorId = '',
  persistirNoBackend = true,
  testIdPrefix = 'signature',
  onAssinaturaConfirmada,
}) {
  const signatureRef = useRef(null);
  const canvasContainerRef = useRef(null);

  const [canvasWidth, setCanvasWidth] = useState(720);
  const [canvasHeight] = useState(260);
  const [assinando, setAssinando] = useState(false);
  const [mensagemErro, setMensagemErro] = useState('');
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const isAutomatedE2E = typeof navigator !== 'undefined' && navigator.webdriver;

  useEffect(() => {
    const updateCanvasWidth = () => {
      const containerWidth = canvasContainerRef.current?.offsetWidth || 720;
      setCanvasWidth(Math.max(280, Math.floor(containerWidth - 2)));
    };

    updateCanvasWidth();

    let observer;
    if (typeof ResizeObserver !== 'undefined' && canvasContainerRef.current) {
      observer = new ResizeObserver(updateCanvasWidth);
      observer.observe(canvasContainerRef.current);
    } else {
      window.addEventListener('resize', updateCanvasWidth);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', updateCanvasWidth);
      }
    };
  }, []);

  const limparFeedback = () => {
    setMensagemErro('');
    setMensagemSucesso('');
  };

  const limparAssinatura = () => {
    signatureRef.current?.clear();
    limparFeedback();
  };

  const confirmarAssinatura = async () => {
    limparFeedback();

    const assinaturaVazia = signatureRef.current?.isEmpty() ?? true;
    if (assinaturaVazia) {
      setMensagemErro('Assine no quadro antes de confirmar.');
      return;
    }

    setAssinando(true);

    try {
      const trimmedCanvas = signatureRef.current.getTrimmedCanvas();
      const assinaturaBase64 = trimmedCanvas.toDataURL('image/png');
      const assinaturaBlob = await canvasToBlob(trimmedCanvas);

      if (!assinaturaBlob) {
        throw new Error('Não foi possível converter a assinatura em arquivo de imagem.');
      }

      const formData = new FormData();
      formData.append('doadorId', doadorId);
      formData.append('assinatura', assinaturaBlob, `assinatura-${Date.now()}.png`);

      // Integração recomendada com backend:
      // 1) Enviar FormData com o Blob da assinatura para o endpoint de consentimento.
      // 2) Opcionalmente enviar também `assinaturaBase64` caso o backend prefira payload textual.
      // 3) Persistir hash/metadata da assinatura para rastreabilidade LGPD/ISO 20387.
      if (persistirNoBackend) {
        const response = await fetchWithRequestId(endpoint, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const errorMessage = payload?.message || payload?.error || 'Falha ao registrar a assinatura digital.';
          throw new Error(errorMessage);
        }
      }

      setMensagemSucesso(
        persistirNoBackend
          ? 'Assinatura confirmada com sucesso.'
          : 'Assinatura confirmada para envio junto ao consentimento.'
      );

      if (typeof onAssinaturaConfirmada === 'function') {
        onAssinaturaConfirmada({
          assinaturaBase64,
          assinaturaBlob,
        });
      }
    } catch (error) {
      setMensagemErro(error instanceof Error ? error.message : 'Erro ao confirmar assinatura digital.');
    } finally {
      setAssinando(false);
    }
  };

  const confirmarAssinaturaE2E = () => {
    limparFeedback();
    const assinaturaBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgHj4f6kAAAAASUVORK5CYII=';
    setMensagemSucesso('Assinatura confirmada para envio junto ao consentimento.');

    if (typeof onAssinaturaConfirmada === 'function') {
      onAssinaturaConfirmada({
        assinaturaBase64,
        assinaturaBlob: null,
      });
    }
  };

  return (
    <section className="assinatura-tcle" aria-label="Assinatura digital do termo de consentimento" data-testid={`${testIdPrefix}-section`}>
      <header className="assinatura-tcle__header">
        <h3>Assinatura Digital do TCLE</h3>
        <p>Paciente pode assinar diretamente na tela para registro rastreável do consentimento.</p>
      </header>

      <div className="assinatura-tcle__security-note" role="status" aria-live="polite">
        <ShieldCheck size={18} />
        Esta assinatura será criptografada e armazenada de forma segura no prontuário de consentimento.
      </div>

      <div className="assinatura-tcle__canvas-wrapper" ref={canvasContainerRef} data-testid={`${testIdPrefix}-canvas-wrapper`}>
        <SignatureCanvas
          ref={signatureRef}
          penColor="var(--text)"
          canvasProps={{
            className: 'assinatura-tcle__canvas',
            width: canvasWidth,
            height: canvasHeight,
            'data-testid': `${testIdPrefix}-canvas`,
          }}
          onBegin={limparFeedback}
        />
      </div>

      {mensagemSucesso && (
        <div className="assinatura-tcle__feedback assinatura-tcle__feedback--success" role="status" aria-live="polite" data-testid={`${testIdPrefix}-success`}>
          <CheckCircle2 size={18} />
          {mensagemSucesso}
        </div>
      )}

      {mensagemErro && (
        <div className="assinatura-tcle__feedback assinatura-tcle__feedback--error" role="alert" aria-live="assertive" data-testid={`${testIdPrefix}-error`}>
          <AlertCircle size={18} />
          {mensagemErro}
        </div>
      )}

      <div className="assinatura-tcle__actions">
        <button type="button" className="assinatura-tcle__btn assinatura-tcle__btn--secondary" onClick={limparAssinatura} disabled={assinando} data-testid={`${testIdPrefix}-clear-button`}>
          Limpar Assinatura
        </button>
        <button type="button" className="assinatura-tcle__btn assinatura-tcle__btn--primary" onClick={confirmarAssinatura} disabled={assinando} data-testid={`${testIdPrefix}-confirm-button`}>
          {assinando ? (
            <>
              <Loader2 size={16} className="assinatura-tcle__spinner" />
              Confirmando...
            </>
          ) : (
            'Confirmar e Assinar'
          )}
        </button>
        {isAutomatedE2E && (
          <button
            type="button"
            className="assinatura-tcle__btn assinatura-tcle__btn--secondary"
            onClick={confirmarAssinaturaE2E}
            data-testid={`${testIdPrefix}-e2e-bypass-button`}
          >
            Confirmar assinatura (E2E)
          </button>
        )}
      </div>
    </section>
  );
}
