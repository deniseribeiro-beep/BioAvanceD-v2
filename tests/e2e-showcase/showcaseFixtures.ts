import { test as base, expect } from '@playwright/test';

// Presentation layer for the showcase reel: a lower-third caption naming what
// the segment demonstrates, and a visible cursor with a click ripple. Headless
// Chromium draws no mouse pointer, so without this a viewer sees fields fill
// and panels open with no sign of what was clicked. Everything here is
// pointer-events:none and sits above the app, so it never changes what the
// spec clicks or asserts.

// One caption per case, in the language the reel's UI is pinned to, keyed by
// the requirement the case title names.
const CAPTIONS: Array<[RegExp, string, string]> = [
  [/RF020 organizations/, 'Organizações, coleções e amostras', 'Cadastro real pela interface, gravado no banco'],
  [/RF014 security/, 'Segurança, equipamentos e etiquetas', 'Política de senha, freezers e etiqueta de amostra'],
  [/RF008 report/, 'Relatórios e backup', 'Modelo de relatório, exportação CSV e rotina de backup'],
  [/RF010 a participant/, 'Consentimento pelo participante', 'O convite chega por e-mail e o participante assina o TCLE'],
  [/RNF011/, 'Importação de planilhas', 'A linha inválida vai para quarentena, não é descartada'],
  [/RF004\/RF020\/RF021/, 'Governança da coleção', 'Aprovação ética registrada com seu contexto'],
  [/RF010 AC3/, 'Termo de consentimento', 'Cada permissão publicada nomeia sua finalidade DUO'],
  [/RF024 an operator/, 'Solicitação de acesso a amostras', 'Registrar, avaliar, aprovar e liberar o espécime'],
  [/RF010 AC6/, 'Revogação de consentimento', 'Uma revogação muda a decisão de acesso de permitir para negar'],
  [/RF009/, 'Monitoramento de freezers', 'Leitura fora da faixa gera um alerta para o operador'],
  [/RF017\/RF006/, 'Armazenamento e estado do espécime', 'Freezer, prateleira, rack, caixa e posição até o esgotamento'],
  [/RF003\/RNF008/, 'Gestão de usuários', 'Cadastro, troca de papel que encerra a sessão e inativação'],
  [/RNF021 AC6/, 'Sessões, auditoria e permissões', 'O usuário encerra suas sessões; o administrador consulta os Logs e as permissões'],
  [/Inventário de Amostras/, 'Login e inventário de amostras', 'Acesso real, as amostras registradas, uma busca e o detalhe do espécime'],
  [/Cadastro integrado/, 'Cadastro integrado de amostras', 'Três passos, análise de qualidade e alocação no freezer'],
];

function captionFor(title: string): [string, string] {
  const hit = CAPTIONS.find(([re]) => re.test(title));
  return hit ? [hit[1], hit[2]] : [title, ''];
}

function installOverlay([heading, sub]: [string, string]) {
  const mount = () => {
    if (document.getElementById('__showcase_overlay')) return;
    const root = document.createElement('div');
    root.id = '__showcase_overlay';
    root.innerHTML = `
      <style>
        #__showcase_overlay, #__showcase_overlay * { pointer-events: none !important; box-sizing: border-box; }
        #__sc_caption { position: fixed; left: 24px; bottom: 24px; z-index: 2147483646;
          max-width: 70vw; padding: 12px 18px 12px 16px; border-radius: 10px;
          background: rgba(15, 23, 42, 0.86); color: #fff; border-left: 5px solid #14b8a6;
          font: 600 20px/1.25 system-ui, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 8px 24px rgba(0,0,0,.25); animation: __sc_in .6s ease-out both; }
        #__sc_caption small { display: block; margin-top: 4px; font-weight: 400; font-size: 15px; color: #cbd5e1; }
        #__sc_cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 22px; height: 22px;
          margin: -11px 0 0 -11px; border-radius: 50%; background: rgba(250, 204, 21, .55);
          border: 2px solid rgba(202, 138, 4, .95); transform: translate(-100px, -100px);
          transition: transform .35s cubic-bezier(.2,.7,.3,1); }
        .__sc_ripple { position: fixed; z-index: 2147483647; width: 16px; height: 16px; margin: -8px 0 0 -8px;
          border-radius: 50%; border: 3px solid rgba(234, 179, 8, .95); animation: __sc_ripple .6s ease-out forwards; }
        @keyframes __sc_ripple { to { transform: scale(4); opacity: 0; } }
        @keyframes __sc_in { from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; } }
      </style>
      <div id="__sc_caption"></div>
      <div id="__sc_cursor"></div>`;
    document.documentElement.appendChild(root);
    const caption = root.querySelector('#__sc_caption') as HTMLElement;
    caption.textContent = heading;
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      caption.appendChild(small);
    }
    const cursor = root.querySelector('#__sc_cursor') as HTMLElement;
    const place = (x: number, y: number) => {
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      sessionStorage.setItem('__sc_xy', `${x},${y}`);
    };
    const last = sessionStorage.getItem('__sc_xy');
    if (last) {
      const [x, y] = last.split(',').map(Number);
      cursor.style.transition = 'none';
      place(x, y);
      requestAnimationFrame(() => { cursor.style.transition = ''; });
    }
    window.addEventListener('mousemove', (e) => place(e.clientX, e.clientY), true);
    window.addEventListener('mousedown', (e) => {
      place(e.clientX, e.clientY);
      const ring = document.createElement('div');
      ring.className = '__sc_ripple';
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      root.appendChild(ring);
      setTimeout(() => ring.remove(), 700);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await page.addInitScript(installOverlay, captionFor(testInfo.title));
    await use(page);
  },
});

export { expect };
