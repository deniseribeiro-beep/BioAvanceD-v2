import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const assistantService = require('../../src/services/assistant.service');
const IntelligentAssistantModel = require('../../src/models/IntelligentAssistant');
const logger = require('../../src/utils/logger');
const i18n = require('../../src/i18n');
const auditLogger = require('../../src/utils/auditLogger');

describe('assistant.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getRoleName', () => {
    it('maps accessType 1-4 to raw role names', () => {
      expect(assistantService.getRoleName(1)).toBe('UsuarioExterno');
      expect(assistantService.getRoleName(2)).toBe('Tecnico');
      expect(assistantService.getRoleName(3)).toBe('Coordenador');
      expect(assistantService.getRoleName(4)).toBe('Administrador');
    });

    it('defaults unknown accessType to UsuarioExterno', () => {
      expect(assistantService.getRoleName(999)).toBe('UsuarioExterno');
      expect(assistantService.getRoleName(undefined)).toBe('UsuarioExterno');
    });
  });

  describe('getRoleNameTranslated', () => {
    it('maps accessType 1-4 to translated role keys', () => {
      const translateSpy = vi.spyOn(i18n, 'translate').mockImplementation((key) => `T:${key}`);

      expect(assistantService.getRoleNameTranslated(1, 'pt-BR')).toBe('T:roles.externalUser');
      expect(assistantService.getRoleNameTranslated(2, 'pt-BR')).toBe('T:roles.technician');
      expect(assistantService.getRoleNameTranslated(3, 'pt-BR')).toBe('T:roles.coordinator');
      expect(assistantService.getRoleNameTranslated(4, 'pt-BR')).toBe('T:roles.administrator');
      expect(translateSpy).toHaveBeenCalledWith('roles.externalUser', 'pt-BR');
    });

    it('defaults unknown accessType to translated externalUser role', () => {
      vi.spyOn(i18n, 'translate').mockImplementation((key) => `T:${key}`);
      expect(assistantService.getRoleNameTranslated(999, 'en-US')).toBe('T:roles.externalUser');
    });
  });

  describe('generateResponse', () => {
    it('matches register keywords with highest priority even when sample keyword also present', () => {
      vi.spyOn(i18n, 'translate').mockImplementation((key) => key);
      // "cadastrar amostra" contains both register keyword 'cadastrar' and sample keyword 'amostra'
      const result = assistantService.generateResponse('Como cadastrar uma amostra?', 2, 'Interface', 'pt-BR');
      expect(result).toContain('assistant.responses.register');
    });

    it('applies role replacement for register response', () => {
      vi.spyOn(i18n, 'translate').mockImplementation((key) => {
        if (key === 'assistant.responses.register') return 'Hello {role}, register here {{role}}';
        return key;
      });
      const result = assistantService.generateResponse('quero cadastrar', 2, 'Interface', 'pt-BR');
      expect(result).toBe('Hello roles.technician, register here roles.technician');
    });

    it('matches sample keywords and does NOT apply role replacement', () => {
      vi.spyOn(i18n, 'translate').mockImplementation((key) => {
        if (key === 'assistant.responses.sample') return 'Sample info {role}';
        return key;
      });
      const result = assistantService.generateResponse('informação sobre amostra', 2, 'Interface', 'pt-BR');
      expect(result).toBe('Sample info {role}');
    });

    it('matches temperature keywords and does NOT apply role replacement', () => {
      vi.spyOn(i18n, 'translate').mockImplementation((key) => {
        if (key === 'assistant.responses.temperature') return 'Temp info {role}';
        return key;
      });
      const result = assistantService.generateResponse('qual a temperature do sensor?', 2, 'Interface', 'pt-BR');
      expect(result).toBe('Temp info {role}');
    });

    it('matches report keywords and does NOT apply role replacement', () => {
      vi.spyOn(i18n, 'translate').mockImplementation((key) => {
        if (key === 'assistant.responses.report') return 'Report info {role}';
        return key;
      });
      const result = assistantService.generateResponse('gerar relatório mensal', 2, 'Interface', 'pt-BR');
      expect(result).toBe('Report info {role}');
    });

    it('falls back to default response with role replacement when no keyword matches', () => {
      vi.spyOn(i18n, 'translate').mockImplementation((key) => {
        if (key === 'assistant.responses.default') return 'Default {role} / {{role}}';
        return key;
      });
      const result = assistantService.generateResponse('what time is it', 3, 'Interface', 'pt-BR');
      expect(result).toBe('Default roles.coordinator / roles.coordinator');
    });
  });

  describe('answerQuestion', () => {
    it('returns answer object with answer, contextScope, modelVersion, timestamp on success', async () => {
      vi.spyOn(i18n, 'translate').mockImplementation((key) => key);
      const result = await assistantService.answerQuestion({}, 'como cadastrar paciente', 2, 'Interface', 'pt-BR');

      expect(result.contextScope).toBe('Interface');
      expect(result.modelVersion).toBe('1.0.0');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(typeof result.answer).toBe('string');
    });

    it('throws and logs when validateAccess returns false', async () => {
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(IntelligentAssistantModel, 'validateAccess').mockReturnValue(false);

      await expect(
        assistantService.answerQuestion({}, 'q', 2, 'Interface', 'pt-BR')
      ).rejects.toThrow('Acesso negado - operação requer dados sensíveis');
      expect(loggerSpy).toHaveBeenCalled();
    });

    it('throws and logs when isValidContextScope returns false', async () => {
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(IntelligentAssistantModel, 'isValidContextScope').mockReturnValue(false);

      await expect(
        assistantService.answerQuestion({}, 'q', 2, 'InvalidScope', 'pt-BR')
      ).rejects.toThrow('ContextScope inválido');
      expect(loggerSpy).toHaveBeenCalled();
    });
  });

  describe('suggestActions', () => {
    it('returns mapped suggestions for a known screen/role combination', async () => {
      const result = await assistantService.suggestActions({}, 'dashboard', 2);
      expect(result.userRole).toBe('Tecnico');
      expect(result.suggestions).toEqual(['Cadastrar amostra', 'Registrar retirada', 'Consultar temperatura']);
      expect(result.screenID).toBe('dashboard');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('falls back to default suggestions when screenID/role combo unknown', async () => {
      const result = await assistantService.suggestActions({}, 'unknown-screen', 2);
      expect(result.suggestions).toEqual(['Navegar pelo sistema', 'Usar assistente']);
    });
  });

  describe('startTutorial', () => {
    it('returns known tutorial for a valid flowID', async () => {
      const result = await assistantService.startTutorial({}, 'cadastro-paciente', 3);
      expect(result.flowID).toBe('cadastro-paciente');
      expect(result.tutorial.title).toBe('Tutorial: Cadastro de Paciente');
      expect(result.tutorial.steps.length).toBeGreaterThan(0);
    });

    it('returns default "não disponível" tutorial for unknown flowID', async () => {
      const result = await assistantService.startTutorial({}, 'nonexistent-flow', 3);
      expect(result.tutorial.title).toBe('Tutorial');
      expect(result.tutorial.steps).toEqual(['Tutorial não disponível para este fluxo']);
    });
  });

  describe('registerGuidanceLog', () => {
    it('calls auditLogger.init and log with expected shape on success', async () => {
      const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      const db = { fakeDb: true };
      const req = { headers: {} };

      await assistantService.registerGuidanceLog(db, 'user1', 'did-something', req);

      expect(initSpy).toHaveBeenCalledWith(db);
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        action: 'ASSISTANT_GUIDANCE',
        entity: 'IntelligentAssistant',
        result: 'success',
        severity: 'info',
        message: 'Orientação fornecida: did-something',
        payload: { action: 'did-something', noSensitiveData: true },
        req,
        module: 'IA Assistente'
      }));
    });

    it('swallows errors from auditLogger.log and resolves without throwing', async () => {
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockRejectedValue(new Error('audit boom'));
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(
        assistantService.registerGuidanceLog({}, 'user1', 'action', {})
      ).resolves.toBeUndefined();
      expect(loggerSpy).toHaveBeenCalled();
    });
  });
});
