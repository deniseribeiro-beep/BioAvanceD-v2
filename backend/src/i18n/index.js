const fs = require('fs');
const path = require('path');

// Carrega os arquivos de tradução
const translationsPath = path.join(__dirname, '../../i18n');
let translations = {};

// Carrega traduções do diretório i18n
function loadTranslations() {
  try {
    const ptBRPath = path.join(translationsPath, 'pt-BR.json');
    const enUSPath = path.join(translationsPath, 'en-US.json');

    if (fs.existsSync(ptBRPath)) {
      translations['pt-BR'] = JSON.parse(fs.readFileSync(ptBRPath, 'utf8'));
    }

    if (fs.existsSync(enUSPath)) {
      translations['en-US'] = JSON.parse(fs.readFileSync(enUSPath, 'utf8'));
    }
  } catch (error) {
    console.error('Erro ao carregar traduções:', error);
    // Fallback para traduções básicas
    translations = {
      'pt-BR': {},
      'en-US': {}
    };
  }
}

// Carrega traduções na inicialização
loadTranslations();

/**
 * Define o idioma atual (para testes ou configuração)
 */
function setLanguage(lang) {
  // No backend, o idioma é determinado por requisição
  // Esta função é mantida para compatibilidade
  return lang;
}

/**
 * Retorna o idioma padrão
 */
function getDefaultLanguage() {
  return 'pt-BR';
}

/**
 * Detecta o idioma a partir de várias fontes
 * @param {Object} req - Objeto de requisição Express
 * @returns {string} Código do idioma (pt-BR ou en-US)
 */
function detectLanguage(req) {
  // 1. Query string ?lang=
  if (req.query && req.query.lang) {
    const lang = req.query.lang.toLowerCase();
    if (lang === 'en' || lang === 'en-us') return 'en-US';
    if (lang === 'pt' || lang === 'pt-br') return 'pt-BR';
  }

  // 2. Header Accept-Language
  if (req.headers && req.headers['accept-language']) {
    const acceptLang = req.headers['accept-language'].toLowerCase();
    if (acceptLang.includes('en')) return 'en-US';
    if (acceptLang.includes('pt')) return 'pt-BR';
  }

  // 3. Idioma salvo no usuário (se autenticado)
  if (req.user && req.user.language) {
    return req.user.language;
  }

  // 4. Padrão: pt-BR
  return 'pt-BR';
}

/**
 * Função de tradução com fallback automático
 * @param {string} key - Chave de tradução (ex: "auth.login")
 * @param {string} lang - Idioma (pt-BR ou en-US)
 * @param {string} fallback - Texto de fallback (opcional)
 * @returns {string} Texto traduzido
 */
function translate(key, lang = 'pt-BR', fallback = null) {
  const keys = key.split('.');
  let value = translations[lang];

  // Navega pela estrutura do objeto
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Fallback para pt-BR se não encontrar no idioma atual
      if (lang !== 'pt-BR') {
        let ptValue = translations['pt-BR'];
        for (const ptKey of keys) {
          if (ptValue && typeof ptValue === 'object' && ptKey in ptValue) {
            ptValue = ptValue[ptKey];
          } else {
            return fallback || key;
          }
        }
        return ptValue || fallback || key;
      }
      return fallback || key;
    }
  }

  return typeof value === 'string' ? value : (fallback || key);
}

/**
 * Middleware para adicionar req.t() em todas as rotas
 */
function languageMiddleware(req, res, next) {
  const previousLang = req.language;
  const lang = detectLanguage(req);
  
  // Adiciona req.language
  req.language = lang;
  
  // Adiciona função de tradução req.t() com tratamento de erro
  req.t = (key, fallback) => {
    try {
      const result = translate(key, lang, fallback);
      // Se retornar a própria chave (não encontrou tradução), usa fallback ou chave
      return result || fallback || key;
    } catch (error) {
      console.error('Erro ao traduzir chave:', key, error);
      return fallback || key;
    }
  };

  // Adiciona header de resposta com o idioma usado
  res.setHeader('Content-Language', lang);

  // Registra mudança de idioma se houver mudança e usuário autenticado
  if (previousLang && previousLang !== lang && req.user) {
    setImmediate(async () => {
      try {
        const db = req.app?.locals?.db;
        if (db) {
          const auditLogger = require('../utils/auditLogger');
          auditLogger.init(db);
          await auditLogger.logLanguageChange(req, lang);
        }
      } catch (error) {
        // Não bloqueia requisição se houver erro no log
      }
    });
  }

  next();
}

module.exports = {
  setLanguage,
  getDefaultLanguage,
  detectLanguage,
  translate,
  languageMiddleware,
  loadTranslations, // Para recarregar traduções em desenvolvimento
};

