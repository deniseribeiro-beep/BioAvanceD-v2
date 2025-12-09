import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // Bloqueia o scroll e previne que a tela de trás apareça
      const body = document.body;
      body.style.position = 'fixed';
      body.style.width = '100%';
      body.style.top = `-${window.scrollY}px`;
    } else {
      const body = document.body;
      const scrollY = body.style.top;
      document.body.style.overflow = 'unset';
      body.style.position = '';
      body.style.width = '';
      body.style.top = '';
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1);
      }
    }
    return () => {
      const body = document.body;
      const scrollY = body.style.top;
      document.body.style.overflow = 'unset';
      body.style.position = '';
      body.style.width = '';
      body.style.top = '';
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1);
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      style={{ 
        backgroundColor: '#ffffff',
        background: '#ffffff',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        minWidth: '100vw',
        minHeight: '100vh',
        zIndex: 999999,
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        opacity: 1,
        visibility: 'visible',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      } as React.CSSProperties}
    >
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: '#ffffff' }}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}


