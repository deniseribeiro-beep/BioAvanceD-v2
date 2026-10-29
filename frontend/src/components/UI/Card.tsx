import { ReactNode, CSSProperties } from 'react';
import './Card.css';

interface CardProps {
  children: ReactNode;
  title?: string;
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
  'data-testid'?: string;
}

export default function Card({ children, title, className = '', onClick, style, 'data-testid': testId }: CardProps) {
  return (
    <div className={`card ${className}`} onClick={onClick} style={style} data-testid={testId}>
      {title && <div className="card-header"><h2 className="card-title">{title}</h2></div>}
      <div className="card-body">{children}</div>
    </div>
  );
}


