import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Ensure global theme tokens are loaded
import './App.css'
import { AuthProvider } from './contexts/AuthContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { ToastProvider } from './components/UI/ToastContainer'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </LanguageProvider>
  </React.StrictMode>,
)


