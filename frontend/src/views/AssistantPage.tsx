import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { MessageCircle, Send, Lightbulb, BookOpen, HelpCircle, Sparkles } from 'lucide-react';
import { useAssistant, AssistantResponse, TutorialResponse } from '../hooks/useAssistant';
import { useLanguage } from '../contexts/LanguageContext';
import './AssistantPage.css';

export default function AssistantPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { consult, answer, getContextualHelp, requestTutorial, getSuggestions, loading, error } = useAssistant();
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState<Array<{ type: 'user' | 'assistant'; content: string; suggestions?: any[] }>>([]);
  const [tutorial, setTutorial] = useState<TutorialResponse | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);

  const handleAsk = async () => {
    if (!question.trim()) return;

    const userQuestion = question;
    setQuestion('');
    
    // Adiciona pergunta do usuário
    setConversation(prev => [...prev, { type: 'user', content: userQuestion }]);

    try {
      const response = await answer(userQuestion);
      
      // Adiciona resposta do assistente
      setConversation(prev => [...prev, {
        type: 'assistant',
        content: response.answer,
        suggestions: response.suggestions
      }]);
    } catch (err: any) {
      setConversation(prev => [...prev, {
        type: 'assistant',
        content: `${t('common.error')}: ${err.message}`
      }]);
    }
  };

  const handleQuickAction = async (action: string) => {
    let response: AssistantResponse;
    
    switch (action) {
      case 'contextual':
        response = await getContextualHelp('sistema');
        setConversation(prev => [...prev, {
          type: 'assistant',
          content: response.contextualHelp?.content || response.answer,
          suggestions: response.suggestions
        }]);
        break;
      case 'tutorial':
        const tutorialData = await requestTutorial('cadastrar paciente');
        setTutorial(tutorialData);
        setShowTutorial(true);
        break;
      default:
        const suggestions = await getSuggestions(action);
        setConversation(prev => [...prev, {
          type: 'assistant',
          content: t('assistant.suggestionsFor').replace('{action}', action),
          suggestions: suggestions
        }]);
    }
  };

  const handleSuggestionClick = (route: string) => {
    navigate(route);
  };

  return (
    <div className="assistant-page">
      <div className="assistant-header">
        <h1>
          <Sparkles /> {t('assistant.title')}
        </h1>
        <p>{t('assistant.subtitle')}</p>
      </div>

      <div className="assistant-content">
        <div className="assistant-main">
          <Card className="chat-card">
            <div className="chat-messages">
              {conversation.length === 0 ? (
                <div className="welcome-message">
                  <MessageCircle size={48} />
                  <h3>{t('assistant.welcome')}</h3>
                  <p>{t('assistant.welcomeHint')}</p>
                </div>
              ) : (
                conversation.map((msg, index) => (
                  <div key={index} className={`message ${msg.type}`}>
                    <div className="message-content">
                      {msg.content}
                    </div>
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="suggestions">
                        <h4>{t('assistant.suggestions')}:</h4>
                        {msg.suggestions.map((suggestion, idx) => (
                          <Button
                            key={idx}
                            variant="secondary"
                            onClick={() => handleSuggestionClick(suggestion.route)}
                          >
                            {suggestion.action}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              {loading && (
                <div className="message assistant">
                  <div className="message-content">
                    {t('assistant.thinking')}
                  </div>
                </div>
              )}
            </div>

            <div className="chat-input">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAsk()}
                placeholder={t('assistant.placeholder')}
                disabled={loading}
              />
              <Button onClick={handleAsk} disabled={loading || !question.trim()}>
                <Send size={16} /> {t('common.submit')}
              </Button>
            </div>
          </Card>
        </div>

        <div className="assistant-sidebar">
          <Card className="quick-actions">
            <h3>{t('assistant.quickActions')}</h3>
            <Button
              variant="secondary"
              onClick={() => handleQuickAction('contextual')}
              disabled={loading}
              className="action-button"
            >
              <HelpCircle /> {t('assistant.contextualHelp')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleQuickAction('tutorial')}
              disabled={loading}
              className="action-button"
            >
              <BookOpen /> {t('assistant.tutorial')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleQuickAction('paciente')}
              disabled={loading}
              className="action-button"
            >
              <Lightbulb /> {t('assistant.patientSuggestions')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleQuickAction('amostra')}
              disabled={loading}
              className="action-button"
            >
              <Lightbulb /> {t('assistant.sampleSuggestions')}
            </Button>
          </Card>
        </div>
      </div>

      {showTutorial && tutorial && (
        <Card className="tutorial-modal">
          <h2>{t('assistant.tutorialTitle')}: {tutorial.topic}</h2>
          <p className="estimated-time">{t('assistant.estimatedTime')}: {tutorial.estimatedTime}</p>
          <ol className="tutorial-steps">
            {tutorial.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
          <Button onClick={() => setShowTutorial(false)}>{t('common.close')}</Button>
        </Card>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
    </div>
  );
}

