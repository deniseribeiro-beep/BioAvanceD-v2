import { useState } from 'react';
import { assistantService } from '../services/api';

export interface AssistantResponse {
  question?: string;
  answer: string;
  suggestions?: Array<{
    action: string;
    description: string;
    route: string;
  }>;
  contextualHelp?: {
    title: string;
    content: string;
    relatedActions: string[];
  };
}

export interface TutorialResponse {
  topic: string;
  steps: string[];
  estimatedTime: string;
}

export function useAssistant() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consult = async (question: string): Promise<AssistantResponse> => {
    try {
      setLoading(true);
      setError(null);
      const response = await assistantService.consult(question);
      return response.data;
    } catch (err: any) {
      setError(err.message || 'Erro ao consultar assistente');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const answer = async (question: string): Promise<AssistantResponse> => {
    try {
      setLoading(true);
      setError(null);
      const response = await assistantService.answer(question);
      return response.data;
    } catch (err: any) {
      setError(err.message || 'Erro ao obter resposta');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getContextualHelp = async (context: string): Promise<AssistantResponse> => {
    try {
      setLoading(true);
      setError(null);
      const response = await assistantService.getContextualHelp(context);
      return response.data;
    } catch (err: any) {
      setError(err.message || 'Erro ao obter ajuda contextual');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const requestTutorial = async (topic: string): Promise<TutorialResponse> => {
    try {
      setLoading(true);
      setError(null);
      const response = await assistantService.requestTutorial(topic);
      return response.data;
    } catch (err: any) {
      setError(err.message || 'Erro ao obter tutorial');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getSuggestions = async (context: string) => {
    try {
      setLoading(true);
      setError(null);
      const response = await assistantService.getSuggestions(context);
      return response.data.suggestions;
    } catch (err: any) {
      setError(err.message || 'Erro ao obter sugestões');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    consult,
    answer,
    getContextualHelp,
    requestTutorial,
    getSuggestions,
  };
}

